// Adapted from sugarforever/smart (2026), MIT; see repository LICENSE.
// A bounded arithmetic parser. No eval, property access, arbitrary functions, or code execution.
export function calculate(input: { name: string; expression: string }[]): Record<string, number> {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50)
    throw new Error('Provide 1–50 calculations.');
  const values: Record<string, number> = Object.create(null);
  const radians = Math.PI / 180;
  const functions: Record<string, { arity: number; run: (...args: number[]) => number }> = {
    sqrt: { arity: 1, run: Math.sqrt },
    abs: { arity: 1, run: Math.abs },
    sin: { arity: 1, run: (x) => Math.sin(x * radians) },
    cos: { arity: 1, run: (x) => Math.cos(x * radians) },
    tan: { arity: 1, run: (x) => Math.tan(x * radians) },
    asin: { arity: 1, run: (x) => Math.asin(x) / radians },
    acos: { arity: 1, run: (x) => Math.acos(x) / radians },
    atan: { arity: 1, run: (x) => Math.atan(x) / radians },
    atan2: { arity: 2, run: (y, x) => Math.atan2(y, x) / radians },
    hypot: { arity: 2, run: Math.hypot },
    min: { arity: 2, run: Math.min },
    max: { arity: 2, run: Math.max },
  };
  for (const item of input) {
    if (
      !item ||
      typeof item.name !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(item.name) ||
      ['constructor', 'prototype', '__proto__', 'pi', 'e'].includes(item.name) ||
      Object.hasOwn(functions, item.name) ||
      Object.hasOwn(values, item.name)
    )
      throw new Error(
        'Calculation names must be unique plain identifiers, excluding constants and function names.',
      );
    if (
      typeof item.expression !== 'string' ||
      !item.expression.trim() ||
      item.expression.length > 1200
    )
      throw new Error('Expression must contain 1–1200 characters.');
    const tokens: string[] = [];
    const matcher = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|[()+\-*/^,]/y;
    let cursor = 0;
    while (cursor < item.expression.length) {
      if (/\s/.test(item.expression[cursor])) {
        cursor++;
        continue;
      }
      matcher.lastIndex = cursor;
      const m = matcher.exec(item.expression);
      if (!m) throw new Error(`Invalid expression character at ${cursor + 1}.`);
      tokens.push(m[0]);
      cursor = matcher.lastIndex;
      if (tokens.length > 512) throw new Error('Expression has too many terms.');
    }
    let index = 0;
    const finite = (value: number) => {
      if (!Number.isFinite(value))
        throw new Error('Calculation has a nonfinite result or invalid domain.');
      return value;
    };
    function parse(minimum = 0, depth = 0): number {
      if (depth > 32) throw new Error('Expression nesting exceeds 32 levels.');
      const token = tokens[index++];
      let result: number;
      if (token === undefined) throw new Error('Incomplete expression.');
      if (token === '+' || token === '-') result = (token === '-' ? -1 : 1) * parse(25, depth + 1);
      else if (token === '(') {
        result = parse(0, depth + 1);
        if (tokens[index++] !== ')') throw new Error('Missing closing parenthesis.');
      } else if (/^(?:\d|\.)/.test(token)) result = finite(Number(token));
      else if (/^[A-Za-z_]/.test(token)) {
        if (tokens[index] === '(') {
          if (!Object.hasOwn(functions, token)) throw new Error(`Unknown function ${token}.`);
          index++;
          const args: number[] = [];
          if (tokens[index] !== ')') {
            while (true) {
              args.push(parse(0, depth + 1));
              if (tokens[index] !== ',') break;
              index++;
              if (args.length > 8) throw new Error('Too many function arguments.');
            }
          }
          if (tokens[index++] !== ')') throw new Error('Missing function closing parenthesis.');
          const f = functions[token];
          if (args.length !== f.arity) throw new Error(`${token} requires ${f.arity} argument(s).`);
          result = finite(f.run(...args));
        } else if (token === 'pi') result = Math.PI;
        else if (token === 'e') result = Math.E;
        else if (Object.hasOwn(values, token)) result = values[token];
        else throw new Error(`Unknown value ${token}.`);
      } else throw new Error(`Unexpected token ${token}.`);
      while (index < tokens.length) {
        const op = tokens[index];
        const binding =
          op === '+' || op === '-' ? 10 : op === '*' || op === '/' ? 20 : op === '^' ? 30 : -1;
        if (binding < minimum) break;
        index++;
        const right = parse(op === '^' ? binding : binding + 1, depth + 1);
        result = finite(
          op === '+'
            ? result + right
            : op === '-'
              ? result - right
              : op === '*'
                ? result * right
                : op === '/'
                  ? result / right
                  : result ** right,
        );
      }
      return finite(result);
    }
    const value = parse();
    if (index !== tokens.length) throw new Error('Unexpected trailing expression tokens.');
    values[item.name] = value;
  }
  return { ...values };
}
