#include <iostream>
#include <string>
#include <vector>

int main() {
    std::string text;
    std::getline(std::cin, text);
    std::vector<char> stack;
    for (char ch : text) {
        if (ch == '(' || ch == '[' || ch == '{') {
            stack.push_back(ch);
        } else {
            if (stack.empty()) {
                std::cout << "NO\n";
                return 0;
            }
            const char open = stack.back();
            stack.pop_back();
            if ((ch == ')' && open != '(') || (ch == ']' && open != '[') ||
                (ch == '}' && open != '{')) {
                std::cout << "NO\n";
                return 0;
            }
        }
    }
    std::cout << (stack.empty() ? "YES\n" : "NO\n");
}
