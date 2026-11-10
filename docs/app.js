"use strict";

const examples = {
  python: {
    linear: "def total(values):\n    result = 0\n    for value in values:\n        result += value\n    return result",
    quadratic: "def pairs(n):\n    count = 0\n    for i in range(n):\n        for j in range(n):\n            count += 1\n    return count",
    linearithmic: "def count_steps(n):\n    count = 0\n    for i in range(n):\n        step = n\n        while step > 1:\n            count += 1\n            step //= 2\n    return count",
  },
  javascript: {
    linear: "function total(values) {\n  let result = 0;\n  for (const value of values) {\n    result += value;\n  }\n  return result;\n}",
    quadratic: "function pairs(n) {\n  let count = 0;\n  for (let i = 0; i < n; i++) {\n    for (let j = 0; j < n; j++) {\n      count++;\n    }\n  }\n  return count;\n}",
    linearithmic: "function countSteps(n) {\n  let count = 0;\n  for (let i = 0; i < n; i++) {\n    for (let step = 1; step < n; step *= 2) {\n      count++;\n    }\n  }\n  return count;\n}",
  },
};

const form = document.querySelector("#analysis");
const code = document.querySelector("#code");
const language = document.querySelector("#language");
const notation = document.querySelector("#notation");
const type = document.querySelector("#type");
const summary = document.querySelector("#summary");
const reasons = document.querySelector("#reasons");
const initial = { notation: notation.textContent, type: type.textContent, summary: summary.textContent, reasons: [] };
let activeExample;

function render(result) {
  notation.textContent = result.notation;
  type.textContent = result.type;
  summary.textContent = result.summary;
  reasons.replaceChildren(...result.reasons.map((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    return item;
  }));
  reasons.hidden = !result.reasons.length;
}

function analyze() {
  render(estimateComplexity(code.value, language.value));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  analyze();
});
code.addEventListener("input", () => {
  activeExample = undefined;
  render(initial);
});
document.querySelector("#clear").addEventListener("click", () => {
  code.value = "";
  activeExample = undefined;
  render(initial);
  code.focus();
});
for (const button of document.querySelectorAll("[data-example]")) {
  button.addEventListener("click", () => {
    activeExample = button.dataset.example;
    code.value = examples[language.value][activeExample];
    analyze();
  });
}
language.addEventListener("change", () => {
  if (activeExample) code.value = examples[language.value][activeExample];
  if (code.value.trim()) analyze();
});
