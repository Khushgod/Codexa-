import math
import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    count = data[0]
    output = []
    for index in range(count):
        left, right = data[1 + 2 * index : 3 + 2 * index]
        divisor = math.gcd(left, right)
        multiple = 0 if divisor == 0 else left // divisor * right
        output.append(f"{divisor} {multiple}")
    print("\n".join(output))


if __name__ == "__main__":
    main()
