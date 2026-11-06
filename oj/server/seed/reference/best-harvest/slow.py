import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    values = data[1:]
    best = values[0]
    for left in range(len(values)):
        total = 0
        for right in range(left, len(values)):
            total += values[right]
            best = max(best, total)
    print(best)


if __name__ == "__main__":
    main()
