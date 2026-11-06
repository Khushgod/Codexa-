import sys


def main():
    text = sys.stdin.buffer.readline().decode().rstrip("\r\n")
    pairs = [("(", ")"), ("[", "]"), ("{", "}")]
    valid = all(text.count(opening) == text.count(closing) for opening, closing in pairs)
    print("YES" if valid else "NO")


if __name__ == "__main__":
    main()
