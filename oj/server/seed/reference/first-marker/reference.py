import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, target = data[0], data[1]
    values = data[2 : 2 + n]
    left, right = 0, n
    while left < right:
        middle = (left + right) // 2
        if values[middle] < target:
            left = middle + 1
        else:
            right = middle
    print(left)


if __name__ == "__main__":
    main()
