import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    best_ending = best = data[1]
    for value in data[2:]:
        best_ending = max(value, best_ending + value)
        best = max(best, best_ending)
    print(best)


if __name__ == "__main__":
    main()
