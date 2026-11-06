import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    count = data[0]
    output = []
    for index in range(count):
        left, right = data[1 + 2 * index : 3 + 2 * index]
        divisor = min(left, right)
        multiple = 0 if divisor == 0 else left * right // divisor
        output.append(f"{divisor} {multiple}")
    print("\n".join(output))


if __name__ == "__main__":
    main()
