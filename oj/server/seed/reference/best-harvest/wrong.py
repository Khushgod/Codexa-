import sys


def main():
    values = list(map(int, sys.stdin.buffer.read().split()))[1:]
    print(sum(value for value in values if value > 0) if any(value > 0 for value in values) else max(values))


if __name__ == "__main__":
    main()
