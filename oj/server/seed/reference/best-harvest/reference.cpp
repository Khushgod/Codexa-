#include <algorithm>
#include <iostream>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n;
    if (!(std::cin >> n)) return 0;
    long long value;
    std::cin >> value;
    long long best_ending = value;
    long long best = value;
    for (int i = 1; i < n; ++i) {
        std::cin >> value;
        best_ending = std::max(value, best_ending + value);
        best = std::max(best, best_ending);
    }
    std::cout << best << '\n';
}
