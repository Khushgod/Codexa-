import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, target = data[0], data[1]
    values = data[2 : 2 + n]
    for index in range(n + 1):
        prefix_is_low = all(value < target for value in values[:index])
        if prefix_is_low and (index == n or values[index] >= target):
            print(index)
            return


if __name__ == "__main__":
    main()
