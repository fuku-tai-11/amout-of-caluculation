"use strict";

const sizePattern = String.raw`(?:[A-Za-z_]\w*|len\([A-Za-z_]\w*\)|[A-Za-z_$][\w$]*\.length)`;
const sizeExpression = new RegExp("^" + sizePattern + "$");
const constant = /^-?\d+$/;
const typedVariable = "(?:(?:[A-Za-z_]\\w*\\s+)*[A-Za-z_]\\w*(?:\\s*\\[\\s*\\])*\\s+)?";
const types = {
  "1": "定数時間",
  "log n": "対数時間",
  n: "線形時間",
  "n log n": "線形対数時間",
  "n²": "二乗時間",
  "n³": "三乗時間",
};

function unknown(message, line) {
  throw new Error((line ? line + " 行目: " : "") + message);
}

// Mask comments and literals before recognizing loops and calls.
function mask(code, language) {
  const tokens = language === "python"
    ? /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|#[^\n]*/g
    : /"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return code.replace(tokens, (token) => {
    const space = token.replace(/[^\n]/g, " ");
    return /^["']/.test(token) ? "0" + space.slice(1) : space;
  });
}

function pythonStatements(code) {
  const root = { children: [] };
  const stack = [{ indent: 0, parent: root }];
  let previous;
  for (const [index, line] of code.split("\n").entries()) {
    const statement = line.trim();
    if (!statement) continue;
    if (/[;\t]/.test(line) || /\\$/.test(statement)) {
      unknown("タブ・複数文・継続行を含む構文に対応していません。", index + 1);
    }
    const indent = line.length - line.trimStart().length;
    if (indent > stack.at(-1).indent) {
      if (!previous?.text.endsWith(":")) unknown("インデントを確認してください。", index + 1);
      stack.push({ indent, parent: previous });
    } else {
      if (previous?.text.endsWith(":")) unknown("ブロック内のコードを入力してください。", previous.line);
      while (indent < stack.at(-1).indent) stack.pop();
      if (indent !== stack.at(-1).indent) unknown("インデントを確認してください。", index + 1);
    }
    previous = { text: statement, line: index + 1, children: [] };
    stack.at(-1).parent.children.push(previous);
  }
  if (previous?.text.endsWith(":")) unknown("ブロック内のコードを入力してください。", previous.line);
  return root.children;
}

function braceStatements(code, language) {
  const root = [];
  const stack = [root];
  const typed = language === "c" || language === "java";
  let buffer = "";
  let line = 1;
  let start = 1;
  let depth = 0;
  function flush() {
    const statement = buffer.trim();
    buffer = "";
    if (!statement) return null;
    const node = { text: statement, line: start, children: [] };
    stack.at(-1).push(node);
    return node;
  }
  for (const char of code) {
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth--;
    if (depth < 0) unknown("括弧の対応を確認してください。", line);
    if (char === "{" && depth === 0) {
      const node = flush();
      if (!node) unknown("この形式のブロックに対応していません。", line);
      if (/^(?:(?:for|while|if|else\s+if)\s*\(|else$)/.test(node.text)) {
        node.block = true;
      } else if (language === "java" && /^(?:(?:public|final|abstract)\s+)*class\s+\w+$/.test(node.text)) {
        node.kind = "class";
      } else if (typed ? /^(?:\w+\s+)+[\w\s*\[\]]*\b\w+\s*\([^()]*\)$/.test(node.text)
                       : /^function\b/.test(node.text)) {
        node.kind = "function";
      } else {
        unknown("この形式のブロックに対応していません。", node.line);
      }
      stack.push(node.children);
    } else if (char === "}" && depth === 0) {
      flush();
      if (stack.length === 1) unknown("波括弧の対応を確認してください。", line);
      stack.pop();
    } else if (depth === 0 && (char === ";" || (!typed && char === "\n" && !/^(?:function\b|for\b|while\b|if\b|else\b)/.test(buffer.trim())))) {
      flush();
    } else {
      if (!buffer.trim()) start = line;
      buffer += char;
    }
    if (char === "\n") line++;
  }
  flush();
  if (stack.length !== 1 || depth !== 0) unknown("括弧の対応を確認してください。", line);
  return root;
}

function powerLabel({ polynomial, logarithmic }) {
  const power = (base, exponent) => exponent === 1 ? base : base + String(exponent).replace(/\d/g, (digit) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[digit]);
  const terms = [];
  if (polynomial) terms.push(power("n", polynomial));
  if (logarithmic) terms.push(power(logarithmic === 1 ? "log n" : "(log n)", logarithmic));
  return terms.join(" ") || "1";
}

function loopCost(node, language) {
  const statement = node.text.replace(/\s/g, "");
  if (language === "python") {
    const range = node.text.match(/^for\s+\w+\s+in\s+range\(([^()]*(?:len\(\w+\)[^()]*)?)\)\s*:$/);
    if (range) {
      const args = range[1].replace(/\s/g, "").split(",");
      if (args.length === 1) return { bound: args[0] };
      if (args.length <= 3 && constant.test(args[0]) && (args.length === 2 || /^[1-9]\d*$/.test(args[2]))) {
        return { bound: args[1] };
      }
    }
    const iterable = node.text.match(/^for\s+\w+\s+in\s+(\w+)\s*:$/);
    if (iterable) return { bound: iterable[1] };
    if (/^while\b/.test(node.text)) {
      const condition = statement.match(/^while(\w+)>[01]:$/);
      if (condition) {
        const variable = condition[1];
        const update = node.children.at(-1)?.text.replace(/\s/g, "");
        const half = new RegExp("^" + variable + "(?://=|=" + variable + "//)(?:[2-9]|[1-9]\\d+)$");
        if (half.test(update)) return { bound: variable, logarithmic: true, shrinking: true };
        if (update === variable + "-=1") return { bound: variable, shrinking: true };
      }
    }
  } else if (node.block) {
    const typed = language === "c" || language === "java";
    const iterable = language === "java"
      ? node.text.match(/^for\s*\(\s*(?:final\s+)?\w+\s+\w+\s*:\s*(\w+)\s*\)$/)
      : language === "javascript" && node.text.match(/^for\s*\(\s*(?:let|const|var)\s+\w+\s+of\s+(\w+)\s*\)$/);
    if (iterable) return { bound: iterable[1] };
    const declaration = typed ? typedVariable : "(?:let|var)\\s+";
    const loop = node.text.match(new RegExp("^for\\s*\\(\\s*" + declaration
      + "(\\w+)\\s*=\\s*(\\d+)\\s*;\\s*(\\w+)\\s*<=?\\s*([^;]+);\\s*([^)]+)\\)$"));
    if (loop && loop[1] === loop[3]) {
      const [, variable, initial, , bound, rawUpdate] = loop;
      const update = rawUpdate.replace(/\s/g, "");
      const increment = new RegExp("^" + variable + "(?:\\+=|=" + variable + "\\+)[1-9]\\d*$");
      if ([variable + "++", "++" + variable].includes(update) || increment.test(update)) {
        return { bound: bound.replace(/\s/g, "") };
      }
      const multiply = new RegExp("^" + variable + "(?:\\*=|=" + variable + "\\*)(?:[2-9]|[1-9]\\d+)$");
      if (Number(initial) > 0 && multiply.test(update)) {
        return { bound: bound.replace(/\s/g, ""), logarithmic: true };
      }
    }
    const condition = statement.match(/^while\((\w+)(?:>[01]|>=1)\)$/);
    if (condition) {
      const variable = condition[1];
      const update = node.children.at(-1)?.text.replace(/\s/g, "");
      if ([variable + "--", "--" + variable, variable + "-=1", variable + "=" + variable + "-1"].includes(update)) {
        return { bound: variable, shrinking: true };
      }
      const divide = new RegExp("^" + variable + "(?:/=|=" + variable + "/)(?:[2-9]|[1-9]\\d+)$");
      if (update === variable + ">>=1" || (typed ? divide.test(update) : update === variable + "=Math.floor(" + variable + "/2)")) {
        return { bound: variable, logarithmic: true, shrinking: true };
      }
    }
  }
  unknown("ループの反復回数を特定できません。", node.line);
}

function estimateComplexity(code, language) {
  try {
    if (!code.trim()) unknown("コードを入力してください。");
    if (code.length > 20000) unknown("20,000 文字以内のコードを入力してください。");
    if (!["python", "javascript", "c", "java"].includes(language)) unknown("対応言語を選択してください。");
    let source = code.replace(/\r\n?/g, "\n");
    if (language === "c") source = source.replace(/^[ \t]*#[ \t]*include[ \t]+(?:<[^>\n]+>|"[^"\n]+")[ \t]*$/gm, "");
    const cleaned = mask(source, language);
    if (language === "javascript" && cleaned.includes(String.fromCharCode(96))) unknown("テンプレートリテラルに対応していません。");
    let nodes = language === "python" ? pythonStatements(cleaned) : braceStatements(cleaned, language);
    if (language === "java") {
      nodes = nodes.filter(({ text }) => !/^(?:package|import(?:\s+static)?)\s+\w+(?:\.(?:\w+|\*))*$/.test(text));
      if (nodes.length === 1 && nodes[0].kind === "class") nodes = nodes[0].children;
    }
    if (!nodes.length) unknown("処理を含むコードを入力してください。");
    const isFunction = (node) => node.kind === "function" || (language === "python" && /^def\s/.test(node.text));
    if (nodes.some(isFunction) && nodes.length !== 1) unknown("解析する関数またはメソッドを 1 つだけ入力してください。");
    const initializerPattern = new RegExp("^" + typedVariable + "(\\w+)\\s*=\\s*(.+)$");
    const reasons = [];
    const sizes = new Set();
    const inputSize = (bound, line) => {
      if (constant.test(bound)) return false;
      if (!sizeExpression.test(bound)) unknown("ループの上限を入力サイズに結びつけられません。", line);
      const name = bound.replace(/^len\((\w+)\)$/, "$1").replace(/\.length$/, "");
      sizes.add(name);
      if (sizes.size > 1) unknown("複数の入力サイズの関係を特定できません。", line);
      return true;
    };

    function visit(items, depth = 0) {
      if (depth > 40) unknown("ブロックの入れ子が深すぎます。");
      let dominant = { polynomial: 0, logarithmic: 0 };
      for (const [index, node] of items.entries()) {
        const { text, children, line } = node;
        let cost = { polynomial: 0, logarithmic: 0 };
        if (/^(?:for|while)\b/.test(text)) {
          const loop = loopCost(node, language);
          let bound = loop.bound;
          if (loop.shrinking) {
            const initializer = items[index - 1]?.text.match(initializerPattern);
            if (initializer?.[1] === bound) bound = initializer[2].replace(/\s/g, "");
          }
          const variableSize = inputSize(bound, line);
          const factor = {
            polynomial: Number(variableSize && !loop.logarithmic),
            logarithmic: Number(variableSize && !!loop.logarithmic),
          };
          reasons.push(line + " 行目のループは O(" + powerLabel(factor) + ") 回反復します。");
          cost = visit(children, depth + 1);
          cost.polynomial += factor.polynomial;
          cost.logarithmic += factor.logarithmic;
        } else if (isFunction(node)) {
          if (depth || !children.length) unknown("関数の定義を確認してください。", line);
          cost = visit(children, depth + 1);
        } else {
          if (node.kind || /^#/.test(text)
              || /^(?:break|continue|yield|import|from|class|try|catch|switch|with|async|await|do|throw|raise|goto)\b/.test(text)
              || /=>|\bnew\b|\[[^\]]*\bfor\b|\b(?:for|while)\b|[^:]\[[^\]]*:[^\]]*\]/.test(text)) {
            unknown("この構文の処理量を特定できません。", line);
          }
          const sort = language === "python" && text.match(/^(?:(?:return\s+|\w+\s*=\s*)?sorted\(\s*(\w+)\s*\)|(\w+)\.sort\(\s*\))$/);
          if (sort) {
            inputSize(sort[1] || sort[2], line);
            cost = { polynomial: 1, logarithmic: 1 };
            reasons.push(line + " 行目は Python のソートです。要素比較を定数時間と仮定します。");
          } else {
            const withoutScalarCalls = text.replace(/\blen\(\s*\w+\s*\)/g, "0")
              .replace(/\bMath\.floor\(\s*\w+\s*\/\s*2\s*\)/g, "0")
              .replace(/^(?:if|else\s+if)\s*(?=\()/, "");
            if (/(?:[\w$]|\]|\))\s*\(/.test(withoutScalarCalls)) unknown("関数呼び出しや再帰の処理量を特定できません。", line);
            if (/^(?:if|elif|else)\b/.test(text)) {
              if (!children.length) unknown("条件分岐の本体をブロックで囲んでください。", line);
              cost = visit(children, depth + 1);
            } else if (children.length || node.block || text.endsWith(":") || /[{}]/.test(text)) {
              unknown("この形式のブロックに対応していません。", line);
            }
          }
        }
        if (cost.polynomial > dominant.polynomial
            || (cost.polynomial === dominant.polynomial && cost.logarithmic > dominant.logarithmic)) dominant = cost;
      }
      return dominant;
    }

    const cost = visit(nodes);
    const label = powerLabel(cost);
    const type = types[label] || (cost.logarithmic ? "多項式・対数時間" : "多項式時間");
    const size = [...sizes][0];
    return {
      notation: "O(" + label + ")",
      type: type + "型",
      summary: size
        ? size + " に対応するサイズを n として推定しました。基本演算は定数時間と仮定しています。"
        : "入力サイズに応じて回数が増える処理は見つかりませんでした。",
      reasons: reasons.slice(0, 8),
    };
  } catch (error) {
    return { notation: "O( ? )", type: "判定できません", summary: error.message, reasons: [] };
  }
}

if (typeof module !== "undefined") module.exports = { estimateComplexity };
