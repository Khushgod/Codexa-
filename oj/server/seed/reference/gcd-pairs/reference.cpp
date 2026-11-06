#include <iostream>

long long gcd(long long left, long long right) {
    while (right != 0) {
        const long long remainder = left % right;
        left = right;
        right = remainder;
    }
    return left;
}

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int count;
    if (!(std::cin >> count)) return 0;
    for (int i = 0; i < count; ++i) {
        long long left;
        long long right;
        std::cin >> left >> right;
        const long long divisor = gcd(left, right);
        const long long multiple = divisor == 0 ? 0 : (left / divisor) * right;
        std::cout << divisor << ' ' << multiple << '\n';
    }
}
