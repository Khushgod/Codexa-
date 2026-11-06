#include <iostream>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n;
    long long target;
    if (!(std::cin >> n >> target)) return 0;
    std::vector<long long> values(n);
    for (auto& value : values) std::cin >> value;

    int left = 0;
    int right = n;
    while (left < right) {
        const int middle = left + (right - left) / 2;
        if (values[middle] < target) left = middle + 1;
        else right = middle;
    }
    std::cout << left << '\n';
}
