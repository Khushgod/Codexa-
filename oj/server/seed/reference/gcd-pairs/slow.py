import sys


def main():
    data = list(map(int, sys.stdin.buffer.read().split()))
    count = data[0]
    output = []
    for index in range(count):
        left, right = data[1 + 2 * index : 3 + 2 * index]
        bound = min(left, right)
        if bound == 0:
            divisor = max(left, right)
        else:
            divisor = 0
            for candidate in range(bound, 0, -1):
                if left % candidate == 0 and right % candidate == 0:
                    divisor = candidate
                    break
        multiple = 0 if divisor == 0 else left // divisor * right
        output.append(f"{divisor} {multiple}")
    print("\n".join(output))


if __name__ == "__main__":
    main()
