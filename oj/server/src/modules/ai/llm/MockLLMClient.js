export class MockLLMClient {
  isRealProvider = false;

  async generate({ messages }) {
    const latest = messages.at(-1)?.content ?? '';
    if (/edge cases|edge case/i.test(latest)) {
      return 'Try the smallest valid input and a case where values repeat. Which boundary is easiest to overlook?';
    }
    if (/why.*wa|wrong answer/i.test(latest)) {
      return 'Compare your behavior on the smallest and largest allowed inputs. Which category did the judge report?';
    }
    if (/fast|complex|efficient/i.test(latest)) {
      return 'Estimate how your work grows as the input doubles. What constraint tells you whether that growth is practical?';
    }
    return 'Let’s restate what the input asks you to find. Which part feels least clear right now?';
  }

  async *stream(input) {
    yield await this.generate(input);
  }
}
