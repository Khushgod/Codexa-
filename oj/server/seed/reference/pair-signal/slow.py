import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    n, target = data[0], data[1]
    values = data[2 : 2 + n]
    for i in range(n):
        for j in range(i + 1, n):
            if values[i] + values[j] == target:
                print(i, j)
                return
    print(-1, -1)


if __name__ == "__main__":
    main()
