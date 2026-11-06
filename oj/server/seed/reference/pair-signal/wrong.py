import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, target = data[0], data[1]
    values = data[2 : 2 + n]
    earliest = {}
    for j, value in enumerate(values):
        if target - value in earliest:
            print(earliest[target - value], j)
            return
        earliest.setdefault(value, j)
    print(-1, -1)


if __name__ == "__main__":
    main()
