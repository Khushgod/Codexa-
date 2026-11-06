#include <algorithm>
#include <iostream>
#include <unordered_map>
#include <utility>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n;
    long long target;
    if (!(std::cin >> n >> target)) return 0;
    std::vector<long long> values(n);
    for (auto& value : values) std::cin >> value;

    std::unordered_map<long long, int> earliest;
    std::pair<int, int> best{n, n};
    for (int j = 0; j < n; ++j) {
        const auto found = earliest.find(target - values[j]);
        if (found != earliest.end()) {
            best = std::min(best, std::pair<int, int>{found->second, j});
        }
        earliest.emplace(values[j], j);
    }

    if (best.first == n) std::cout << "-1 -1\n";
    else std::cout << best.first << ' ' << best.second << '\n';
}
