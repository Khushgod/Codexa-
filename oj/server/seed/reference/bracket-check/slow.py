import sys


def balanced(text):
    matching = {")": "(", "]": "[", "}": "{"}
    stack = []
    for char in text:
        if char in "([{":
            stack.append(char)
        elif not stack or stack.pop() != matching[char]:
            return False
    return not stack


def main():
    text = sys.stdin.buffer.readline().decode().rstrip("\r\n")
    if not text:
        print("YES")
        return
    for end in range(1, len(text) + 1):
        balanced(text[:end])
    print("YES" if balanced(text) else "NO")


if __name__ == "__main__":
    main()
