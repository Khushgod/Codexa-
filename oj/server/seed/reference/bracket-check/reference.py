import sys


def main():
    text = sys.stdin.buffer.readline().decode().rstrip("\r\n")
    matching = {")": "(", "]": "[", "}": "{"}
    stack = []
    for char in text:
        if char in "([{":
            stack.append(char)
        elif not stack or stack.pop() != matching[char]:
            print("NO")
            return
    print("YES" if not stack else "NO")


if __name__ == "__main__":
    main()
