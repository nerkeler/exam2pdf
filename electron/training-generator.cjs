function seededRandom(seed) {
  let value = Number(seed) >>> 0 || 1;
  return (min, max) => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return min + value % (max - min + 1);
  };
}

function signed(value) {
  return value < 0 ? "- " + Math.abs(value) : "+ " + value;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : Math.abs(a);
}

function generatePractice(topic, seed = Date.now()) {
  const random = seededRandom(seed);
  const questions = [];
  const name = String(topic || "").trim() || "基础运算";

  if (name.includes("方程") || name.includes("移项") || name.includes("去括号")) {
    for (let index = 0; index < 5; index++) {
      const a = random(2, 9);
      const x = random(-5, 12);
      const b = random(-12, 12);
      const result = a * x + b;
      questions.push({
        prompt: "解方程：" + a + "x " + signed(b) + " = " + result,
        answer: a + "x = " + (result - b) + "，所以 x = " + x + "。"
      });
    }
  } else if (name.includes("分数")) {
    for (let index = 0; index < 5; index++) {
      const denominator = random(3, 12);
      const first = random(1, denominator - 1);
      const second = random(1, denominator - 1);
      const sign = random(0, 1) ? 1 : -1;
      const numerator = first + sign * second;
      const divisor = gcd(numerator, denominator) || 1;
      const reducedNumerator = numerator / divisor;
      const reducedDenominator = denominator / divisor;
      const answer = reducedDenominator === 1 ? String(reducedNumerator) : reducedNumerator + "/" + reducedDenominator;
      questions.push({
        prompt: "计算：" + first + "/" + denominator + (sign > 0 ? " + " : " − ") + second + "/" + denominator,
        answer: "分母相同，" + first + (sign > 0 ? " + " : " − ") + second + " = " + numerator + "，约分后为 " + answer + "。"
      });
    }
  } else if (name.includes("有理数") || name.includes("运算") || name.includes("计算")) {
    const operators = ["+", "−", "×", "÷"];
    for (let index = 0; index < 5; index++) {
      const operator = operators[random(0, operators.length - 1)];
      let a = random(-12, 12);
      let b = random(-12, 12);
      let answer;
      if (operator === "+") answer = a + b;
      else if (operator === "−") answer = a - b;
      else if (operator === "×") answer = a * b;
      else {
        b = random(2, 9);
        const quotient = random(-9, 9);
        a = quotient * b;
        answer = quotient;
      }
      questions.push({ prompt: "计算：" + a + " " + operator + " (" + b + ")", answer: "结果：" + answer + "。" });
    }
  } else if (name.includes("角") || name.includes("几何") || name.includes("平行")) {
    const angle = random(25, 155);
    const other = 180 - angle;
    const triangleAngleA = random(30, 100);
    const triangleAngleB = random(15, Math.min(100, 179 - triangleAngleA));
    const topAngle = random(30, 120);
    questions.push(
      { prompt: "两条平行线被第三条直线所截，一个同位角为 " + angle + "°。另一个同位角是多少度？", answer: "两直线平行，同位角相等，所以是 " + angle + "°。" },
      { prompt: "一对邻补角中，一个角为 " + angle + "°，求另一个角。", answer: "邻补角和为 180°，所以另一个角为 180° − " + angle + "° = " + other + "°。" },
      { prompt: "一对对顶角中，一个角为 " + angle + "°，求另一个角。", answer: "对顶角相等，所以另一个角为 " + angle + "°。" },
      { prompt: "三角形两个内角分别为 " + triangleAngleA + "° 和 " + triangleAngleB + "°，第三个内角是多少度？", answer: "三角形内角和为 180°，第三个角为 180° − " + triangleAngleA + "° − " + triangleAngleB + "° = " + (180 - triangleAngleA - triangleAngleB) + "°。" },
      { prompt: "一个等腰三角形的顶角为 " + topAngle + "°，求一个底角。", answer: "两个底角相等，底角 =（180° − " + topAngle + "°）÷ 2 = " + (180 - topAngle) / 2 + "°。" }
    );
  } else {
    for (let index = 0; index < 5; index++) {
      const a = random(10, 99);
      const b = random(2, 20);
      questions.push({ prompt: "计算：" + a + " + " + b + " × 2", answer: "先算乘法：" + a + " + " + (b * 2) + " = " + (a + b * 2) + "。" });
    }
  }

  return { topic: name, source: "本地基础题型模板", createdAt: new Date().toISOString(), questions: questions.slice(0, 5) };
}

module.exports = { generatePractice };
