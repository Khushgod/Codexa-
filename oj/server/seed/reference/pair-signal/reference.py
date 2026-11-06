import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, target = data[0], data[1]
    values = data[2 : 2 + n]
    earliest = {}
    best = None

    for j, value in enumerate(values):
        i = earliest.get(target - value)
        if i is not None:
            candidate = (i, j)
            if best is None or candidate < best:
                best = candidate
        earliest.setdefault(value, j)

    print(*(best if best is not None else (-1, -1)))


if __name__ == "__main__":
    main()
