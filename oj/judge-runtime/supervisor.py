#!/usr/bin/env python3
import base64
import binascii
import ctypes
import json
import math
import os
import resource
import signal
import sys
import tempfile
import time


MAX_LINE_BYTES = 2 * 1024 * 1024
UID = 65534
GID = 65534
LANGUAGES = {
    "cpp": {
        "source": "main.cpp",
        "compile": ["g++", "-std=c++17", "-O2", "-pipe", "-o", "/work/program", "/work/main.cpp"],
        "run": ["/work/program"],
    },
    "python": {
        "source": "main.py",
        "compile": [
            "python3",
            "-I",
            "-B",
            "-c",
            "import py_compile; py_compile.compile('/work/main.py', cfile='/work/program.pyc', doraise=True)",
        ],
        "run": [
            "python3",
            "-I",
            "-B",
            "-c",
            "import importlib.machinery,sys; path='/work/program.pyc'; sys.argv[0]='/work/main.py'; loader=importlib.machinery.SourcelessFileLoader('__main__',path); exec(loader.get_code('__main__'), {'__name__':'__main__','__file__':'/work/main.py','__package__':None})",
        ],
    },
    "java": {
        "source": "Main.java",
        "compile": ["javac", "-encoding", "UTF-8", "/work/Main.java"],
        "run": ["java", "-Xmx256m", "-Xss2m", "-XX:+UseSerialGC", "-cp", "/work", "Main"],
    },
}


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def decode(value):
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error, TypeError) as error:
        raise ValueError("Invalid base64 protocol field") from error


def clear_child_capabilities():
    class Header(ctypes.Structure):
        _fields_ = [("version", ctypes.c_uint32), ("pid", ctypes.c_int)]

    class Data(ctypes.Structure):
        _fields_ = [
            ("effective", ctypes.c_uint32),
            ("permitted", ctypes.c_uint32),
            ("inheritable", ctypes.c_uint32),
        ]

    libc = ctypes.CDLL(None, use_errno=True)
    header = Header(0x20080522, 0)
    data = (Data * 2)()
    if libc.capset(ctypes.byref(header), ctypes.byref(data)) != 0:
        raise OSError(ctypes.get_errno(), "capset failed")


def child_setup(limits):
    os.setsid()
    resource.setrlimit(resource.RLIMIT_CPU, (limits["cpuSeconds"], limits["cpuSeconds"] + 1))
    resource.setrlimit(
        resource.RLIMIT_FSIZE,
        (limits["fileSizeLimitBytes"], limits["fileSizeLimitBytes"]),
    )
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if hasattr(resource, "RLIMIT_NPROC"):
        resource.setrlimit(resource.RLIMIT_NPROC, (limits["pidsLimit"], limits["pidsLimit"]))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    os.setgroups([])
    os.setgid(GID)
    os.setuid(UID)
    clear_child_capabilities()


def oom_kill_count():
    try:
        with open("/sys/fs/cgroup/memory.events", "r", encoding="ascii") as events:
            for line in events:
                key, value = line.split()
                if key == "oom_kill":
                    return int(value)
    except (FileNotFoundError, PermissionError, OSError, ValueError):
        return None
    return None


def run_child(command, stdin_fd, limits, timeout_ms, combine_stderr=False):
    stdout_file = tempfile.TemporaryFile(dir="/tmp")
    stderr_file = stdout_file if combine_stderr else tempfile.TemporaryFile(dir="/tmp")
    before_oom = oom_kill_count()
    pid = os.fork()
    if pid == 0:
        try:
            os.dup2(stdin_fd, 0)
            os.dup2(stdout_file.fileno(), 1)
            os.dup2(stderr_file.fileno(), 2)
            child_setup(limits)
            os.chdir("/work")
            os.execvpe(command[0], command, {"PATH": "/usr/bin:/bin", "HOME": "/tmp"})
        except BaseException:
            os._exit(127)

    started = time.monotonic()
    deadline = started + timeout_ms / 1000
    timed_out = False
    usage = None
    status = None
    while True:
        try:
            finished_pid, status, usage = os.wait4(pid, os.WNOHANG)
        except InterruptedError:
            continue
        if finished_pid == pid:
            break
        if time.monotonic() >= deadline:
            timed_out = True
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            _, status, usage = os.wait4(pid, 0)
            break
        time.sleep(0.01)

    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    wall_ms = int((time.monotonic() - started) * 1000)
    exit_code = os.waitstatus_to_exitcode(status)
    signal_number = -exit_code if exit_code < 0 else None
    cpu_ms = int((usage.ru_utime + usage.ru_stime) * 1000) if usage else 0
    mem_kb = int(usage.ru_maxrss) if usage else 0
    output_bytes = limits["outputBytes"]
    stdout_file.seek(0, os.SEEK_END)
    stdout_size = stdout_file.tell()
    stdout_file.seek(0)
    stdout = stdout_file.read(output_bytes)
    if stderr_file is stdout_file:
        stderr = b""
        stderr_size = 0
    else:
        stderr_file.seek(0, os.SEEK_END)
        stderr_size = stderr_file.tell()
        stderr_file.seek(0)
        stderr = stderr_file.read(min(output_bytes, 4096))
        stderr_file.close()
    stdout_file.close()
    after_oom = oom_kill_count()
    oom_killed = (
        before_oom is not None
        and after_oom is not None
        and after_oom > before_oom
    )
    output_cap_hit = (
        stdout_size > output_bytes
        or stderr_size > output_bytes
        or signal_number == signal.SIGXFSZ
    )
    return {
        "exit": exit_code if exit_code >= 0 else None,
        "signal": signal_number,
        "cpuMs": cpu_ms,
        "wallMs": wall_ms,
        "memKb": mem_kb,
        "stdout": base64.b64encode(stdout).decode("ascii"),
        "stderr": base64.b64encode(stderr).decode("ascii"),
        "outputCapHit": output_cap_hit,
        "oomKilled": oom_killed,
        "javaOutOfMemory": b"OutOfMemoryError" in stderr,
        "cpuLimitHit": signal_number == signal.SIGXCPU or cpu_ms >= limits["cpuSeconds"] * 1000,
        "wallLimitHit": timed_out,
    }


def compile_source(request, language):
    config = LANGUAGES[language]
    source = decode(request.get("source", ""))
    if len(source) > 64 * 1024:
        raise ValueError("Source exceeds the supported size.")
    os.makedirs("/work", mode=0o777, exist_ok=True)
    os.chmod("/work", 0o777)
    source_path = os.path.join("/work", config["source"])
    with open(source_path, "wb") as source_file:
        source_file.write(source)
    os.chmod(source_path, 0o444)

    limits = request.get("limits", {})
    time_ms = int(limits.get("timeMs", 15000))
    output_bytes = int(limits.get("outputBytes", 65536))
    pids_limit = int(limits.get("pidsLimit", 64))
    devnull = os.open("/dev/null", os.O_RDONLY)
    result = run_child(
        config["compile"],
        devnull,
        {
            "cpuSeconds": max(1, math.ceil(time_ms / 1000)),
            "outputBytes": output_bytes,
            "fileSizeLimitBytes": 512 * 1024 * 1024,
            "pidsLimit": pids_limit,
        },
        timeout_ms=time_ms * 2 + 2000,
        combine_stderr=True,
    )
    os.close(devnull)
    log = decode(result["stdout"])
    if (
        result["exit"] == 0
        and not result["outputCapHit"]
        and not result["oomKilled"]
        and not result["cpuLimitHit"]
        and not result["wallLimitHit"]
    ):
        for root, dirs, files in os.walk("/work", topdown=False):
            for name in files:
                path = os.path.join(root, name)
                os.chmod(path, os.stat(path).st_mode & ~0o222)
            for name in dirs:
                os.chmod(os.path.join(root, name), 0o555)
        os.chmod("/work", 0o555)
        return {"op": "compile", "ok": True}
    return {
        "op": "compile",
        "ok": False,
        "log": base64.b64encode(log[:4096]).decode("ascii"),
        "cpuLimitHit": result["cpuLimitHit"],
        "wallLimitHit": result["wallLimitHit"],
        "outputCapHit": result["outputCapHit"],
        "oomKilled": result["oomKilled"],
    }


def run_test(request, language):
    config = LANGUAGES[language]
    input_bytes = decode(request.get("input", ""))
    input_file = tempfile.TemporaryFile(dir="/tmp")
    input_file.write(input_bytes)
    input_file.seek(0)
    limits = request.get("limits", {})
    time_ms = int(limits.get("timeMs", 1000))
    output_bytes = int(limits.get("outputBytes", 262144))
    run_result = run_child(
        [
            f"-Xmx{max(32, int(limits.get('memoryMb', 256)) - 96)}m"
            if language == "java" and argument.startswith("-Xmx")
            else argument
            for argument in config["run"]
        ],
        input_file.fileno(),
        {
            "cpuSeconds": max(1, math.ceil(time_ms / 1000)),
            "outputBytes": output_bytes,
            "fileSizeLimitBytes": output_bytes + 1,
            "pidsLimit": int(limits.get("pidsLimit", 64)),
        },
        timeout_ms=time_ms * 2 + 500,
    )
    input_file.close()
    run_result["op"] = "run"
    return run_result


def main():
    language = None
    compiled = False
    for raw in sys.stdin.buffer:
        if len(raw) > MAX_LINE_BYTES:
            emit({"op": "error", "message": "Protocol message too large."})
            return 2
        try:
            request = json.loads(raw)
            operation = request.get("op")
            if operation == "shutdown":
                return 0
            if operation == "compile":
                language = request.get("language")
                if language not in LANGUAGES:
                    raise ValueError("Unsupported language.")
                response = compile_source(request, language)
                compiled = response["ok"]
                emit(response)
            elif operation == "run":
                if not compiled or language not in LANGUAGES:
                    raise ValueError("Source has not compiled.")
                emit(run_test(request, language))
            else:
                raise ValueError("Unsupported protocol operation.")
        except (ValueError, TypeError, KeyError, OSError, json.JSONDecodeError) as error:
            emit({"op": "error", "message": str(error)[:200]})
        except Exception:
            emit({"op": "error", "message": "Supervisor internal error."})
    return 0


if __name__ == "__main__":
    sys.exit(main())
