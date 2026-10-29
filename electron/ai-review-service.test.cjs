const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiReview, testAiConnection, completionUrl, normalizeReview, parseExternalReview } = require("./ai-review-service.cjs");

function image(bytes = "page") {
  return { mime: "image/jpeg", bytes: Buffer.from(bytes) };
}

test("sends local page data as image inputs and normalizes a review draft", async () => {
  let request;
  const serviceResponse = new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ questions: [{
      questionNo: "1", result: "错误", errorType: "计算", knowledgePoints: ["分数运算"],
      studentAnswer: "1/2", correctAnswer: "2/3", solutionSummary: "通分后计算。"
    }] }) } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await createAiReview({
    baseUrl: "https://api.example.test/v1/",
    model: "vision-model",
    apiKey: "test-key",
    images: [image()],
    fetchImpl: async (url, options) => { request = { url, options }; return serviceResponse; }
  });

  assert.equal(request.url, "https://api.example.test/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(request.options.body);
  const imagePart = body.messages[0].content.find((part) => part.type === "image_url");
  assert.equal(imagePart.image_url.url, "data:image/jpeg;base64," + Buffer.from("page").toString("base64"));
  assert.equal(result.model, "vision-model");
  assert.deepEqual(result.review[0], {
    questionNo: "1", result: "错误", errorType: "计算", knowledgePoints: ["分数运算"],
    studentAnswer: "1/2", correctAnswer: "2/3", solutionSummary: "通分后计算。", mastered: false
  });
});

test("rejects insecure endpoints, malformed model output, and invalid image batches", async () => {
  assert.equal(completionUrl("https://api.example.test/v1/chat/completions"), "https://api.example.test/v1/chat/completions");
  assert.throws(() => completionUrl("http://api.example.test/v1"), /HTTPS/);
  assert.throws(() => normalizeReview({ questions: [{ questionNo: "1", result: "猜对了" }] }), /判定结果/);
  await assert.rejects(createAiReview({
    baseUrl: "https://api.example.test/v1", model: "vision-model", apiKey: "key", images: [{ mime: "image/svg+xml", bytes: Buffer.from("<svg/>") }], fetchImpl: async () => { throw new Error("should not call"); }
  }), /图片格式无效/);
});

test("surfaces bounded service errors without treating them as review data", async () => {
  await assert.rejects(createAiReview({
    baseUrl: "https://api.example.test/v1", model: "vision-model", apiKey: "key", images: [image()],
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "model does not support image input" } }), { status: 400 })
  }), /HTTP 400.*model does not support image input/);
});

test("tests connectivity with a text-only prompt, then probes image-input support", async () => {
  const requests = [];
  const result = await testAiConnection({
    baseUrl: "https://api.example.test/v1", model: "vision-model", apiKey: "test-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
    }
  });
  assert.equal(result.connected, true);
  assert.equal(result.vision, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.example.test/v1/chat/completions");
  assert.equal(requests[0].headers.Authorization, "Bearer test-key");
  assert.equal(requests[0].body.messages[0].content, "连接测试。请只回复 OK。");
  assert.equal(Object.hasOwn(requests[0].body.messages[0], "images"), false);
  // 第二次请求带 1x1 探针图片，用于判定模型能否接收图片输入
  const imagePart = requests[1].body.messages[0].content.find((part) => part.type === "image_url");
  assert.match(imagePart.image_url.url, /^data:image\/png;base64,/);
});

test("connection test reports text-only models as vision-incapable with the service's reason", async () => {
  const result = await testAiConnection({
    baseUrl: "https://api.example.test/v1", model: "deepseek-chat", apiKey: "test-key",
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (Array.isArray(body.messages[0].content)) {
        return new Response(JSON.stringify({ error: { message: "Images are not supported by this model" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
    }
  });
  assert.equal(result.connected, true);
  assert.equal(result.vision, false);
  assert.match(result.visionDetail, /Images are not supported/);
});

test("connection test keeps vision unknown when the probe fails at the network level", async () => {
  let calls = 0;
  const result = await testAiConnection({
    baseUrl: "https://api.example.test/v1", model: "m", apiKey: "k",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
      throw new Error("socket hang up");
    }
  });
  assert.equal(result.connected, true);
  assert.equal(result.vision, null);
  assert.match(result.visionDetail, /socket hang up/);
});

test("parses pasted external-AI output into the same normalized draft as the API path", () => {
  const draft = JSON.stringify({ questions: [
    { questionNo: "1", result: "错误", errorType: "计算", knowledgePoints: ["去括号"], studentAnswer: "x=3", correctAnswer: "x=5", solutionSummary: "【重点：漏变号】去括号时未变号。" },
    { questionNo: "2", result: "正确" }
  ] });
  // 纯 JSON、Markdown 围栏、文字包裹、裸数组四种常见输出形态都能解析
  for (const text of [
    draft,
    "```json\n" + draft + "\n```",
    "批阅结果如下：\n" + draft + "\n以上就是全部批阅。",
    JSON.stringify(JSON.parse(draft).questions)
  ]) {
    const result = parseExternalReview(text);
    assert.equal(result.model, "外部 AI 网页批阅");
    assert.equal(result.review.length, 2);
    assert.equal(result.review[0].result, "错误");
    assert.equal(result.review[1].errorType, "其他");
    assert.match(result.review[0].solutionSummary, /【重点：漏变号】/);
  }
});

test("rejects pasted external-AI output without a recognizable review", () => {
  assert.throws(() => parseExternalReview("这家 AI 只输出了 markdown 表格，没有 JSON"), /粘贴内容无法识别/);
  assert.throws(() => parseExternalReview('{"questions":[{"questionNo":"1","result":"猜对了"}]}'), /判定结果/);
  assert.throws(() => parseExternalReview('{"questions":[{"questionNo":"1","result":"错误"},{"questionNo":"1","result":"正确"}]}'), /重复题号/);
  assert.throws(() => parseExternalReview(""), /粘贴内容/);
});

// 真实用户案例：豆包返回的批阅 JSON 含两处损坏——Q3 的 knowledgePoints 写成
// 裸字符串串（非法 JSON），Q18 的 solutionSummary 结尾引号缺失（输出被截断）
const USER_PASTED = `{"questions":[{"questionNo":"1","result":"正确","knowledgePoints":["点到坐标轴的距离","平面直角坐标系坐标特征"],"studentAnswer":"选A，点P(-2,5)到y轴距离为2","correctAnswer":"A，距离为|x|=|-2|=2","solutionSummary":"点到y轴的距离等于横坐标的绝对值，|-2|=2，选A正确。【重点：到y轴距离看横坐标绝对值，到x轴距离看纵坐标绝对值，二者勿混淆】"},{"questionNo":"2","result":"错误","errorType":"审题","knowledgePoints":["函数自变量取值范围","二次根式有意义条件","分式分母不为零"],"studentAnswer":"选C（x≥-3且x≠-2）","correctAnswer":"D（x≥-3且x≠2）","solutionSummary":"根号内x+3≥0得x≥-3；分母x-2≠0得x≠2，两个条件联立为x≥-3且x≠2，应选D。【重点：分母是x-2，非零条件是x≠2，学生误写成x≠-2，把分母零点符号搞反】"},{"questionNo":"3","result":"正确","knowledgePoints":"直线平行于坐标轴的坐标特征","垂线段最短","最短距离问题","studentAnswer":"选D，C(3,2)","correctAnswer":"D，C(3,2)","solutionSummary":"过A(3,3)平行于y轴的直线为x=3，BC最短时C与B纵坐标相同，C(3,2)，选D正确。【重点：平行y轴的直线上所有点横坐标相同，垂线段最短对应纵坐标取B的值】"},{"questionNo":"4","result":"正确","knowledgePoints":["一次函数实际应用","剩余电量与路程关系"],"studentAnswer":"选B，Q=60-0.1s","correctAnswer":"B，Q=60-0.1s","solutionSummary":"每千米耗电1÷10=0.1kW·h，剩余电量Q=60-0.1s，自变量为s，选B正确。【重点：题目问剩余电量Q与行驶路程s的关系，应以Q为因变量列式】"},{"questionNo":"5","result":"错误","errorType":"概念","knowledgePoints":["一次函数增减性","斜率符号判断","因式乘积符号"],"studentAnswer":"选C，a>1","correctAnswer":"D，a<1","solutionSummary":"y=ax-x+2=(a-1)x+2，(x1-x2)(y1-y2)<0说明y随x增大而减小，斜率a-1<0，即a<1，应选D。【重点：乘积<0表示两点增减方向相反，即斜率为负，需先把x合并成(a-1)x再判断符号】"},{"questionNo":"6","result":"错误","errorType":"概念","knowledgePoints":["一次函数图象与系数关系","mnp<0符号判断","定点(-1,0)"],"studentAnswer":"选B","correctAnswer":"C","solutionSummary":"y2=px+p=p(x+1)恒过定点(-1,0)；选项C中y1下降(m<0)、纵截距n>0，y2上升且p>0，mnp<0成立。选项B中m>0、n<0、p<0，乘积mnp>0，不满足条件。【重点：先利用y2恒过(-1,0)筛选，再结合mnp<0判断三系数正负，不能只看单条直线】"},{"questionNo":"7","result":"错误","errorType":"计算","knowledgePoints":["函数图象信息读取","行程问题速度计算","相遇时间"],"studentAnswer":"先选D后划掉，最终选C","correctAnswer":"D","solutionSummary":"小明20分钟走1200米，平均速度=1200÷20=60米/分，不是80，故D说法错误，应选D；C项小华t=8出发、速度240米/分，240(t-8)=480得t=10即7:50相遇，说法正确。【重点：平均速度=总路程÷总时间，1200÷20=60，不能用跑步段速度代替全程平均速度】"},{"questionNo":"8","result":"正确","knowledgePoints":["坐标平移的逆推","平移向量"],"studentAnswer":"选D，A(-3,4)","correctAnswer":"D，A(-3,4)","solutionSummary":"平移向量为(+8,-5)，A1=A+(8,-5)，故A=(5-8,-1+5)=(-3,4)，选D正确。【重点：已知平移后点反推原点点坐标，坐标用减法逆推】"},{"questionNo":"9","result":"正确","knowledgePoints":["一次函数图象性质","一元一次不等式解集","交点代入比较系数"],"studentAnswer":"选C（①③④）","correctAnswer":"C（①③④）","solutionSummary":"①y1下降y随x减小而减小正确；②y2上升且纵截距为负，过一三四象限而非一二四，错误；③y1在交点x=3左侧高于y2，解集x<3正确；④代入x=3得3a+b=3c+d，整理a-c=(d-b)/3正确。【重点：判断②要看清y2与y轴交点在负半轴，不能只凭上升趋势】"},{"questionNo":"10","result":"错误","errorType":"方法","knowledgePoints":["规律探究","正方形与直线y=x+2","坐标递推"],"studentAnswer":"选B（2^2023+2,2^2024）","correctAnswer":"A（2^2025-2,2^2024）","solutionSummary":"B1(2,2)、B2(6,4)、B3(14,8)，归纳Bn=(2^(n+1)-2,2^n)，故B2024=(2^2025-2,2^2024)，应选A。【重点：横坐标是等比累加2+4+…+2^n=2^(n+1)-2，学生递推通项时指数规律写错】"},{"questionNo":"11","result":"错误","errorType":"概念","knowledgePoints":["正比例函数最值","分类讨论k正负","区间端点取最值"],"studentAnswer":"涂改后无可辨认有效答案（疑似写-3/4后划掉）","correctAnswer":"k=3/4或k=-3/4","solutionSummary":"k>0时最大值在x=4处，4k=3得k=3/4；k<0时最大值在x=-4处，-4k=3得k=-3/4，两种情况都要讨论。【重点：正比例函数最值随k正负落在不同端点，必须分类讨论，漏解即错】"},{"questionNo":"12","result":"正确","knowledgePoints":["平移向量","坐标平移"],"studentAnswer":"先写(8,7)划掉，最终(7,-8)","correctAnswer":"(7,-8)","solutionSummary":"平移向量Q-P=(4-(-1),-2-3)=(5,-5)，M(2,-3)+(5,-5)=(7,-8)，正确。【重点：先由一组对应点求平移量(+5,-5)，再作用于M，横纵坐标分别加减】"},{"questionNo":"13","result":"未作答","errorType":"其他","knowledgePoints":["一次函数恒过定点","含参直线整理"],"studentAnswer":"空白未答","correctAnswer":"(3,15)","solutionSummary":"y=(5-2k)x+6k=5x+k(-2x+6)，令-2x+6=0得x=3，y=15，恒过(3,15)。【重点：把含k的项合并，令k的系数为零求定点，与k取值无关】"},{"questionNo":"14","result":"未作答","errorType":"其他","knowledgePoints":["待定系数法求参数","闭区间一次函数最值","分类讨论m正负"],"studentAnswer":"两小问均空白未答","correctAnswer":"(1)m=10；(2)m=2或m=-3/2","solutionSummary":"(1)代入(1,-2)：m+8-2m=-2得m=10；(2)m>0最大值在x=5，3m+8=14得m=2；m<0最大值在x=-2，8-4m=14得m=-3/2。【重点：闭区间上一次函数最值只在端点取得，必须按斜率正负分类讨论两个端点】"},{"questionNo":"15","result":"错误","errorType":"计算","knowledgePoints":["待定系数法","解二元一次方程组","一次函数解析式"],"studentAnswer":"列对方程组，解得k=3、b=9，写y=3x+9","correctAnswer":"y=3x+3","solutionSummary":"方程组-2k+b=-3，k+b=6，两式相减得3k=9，k=3，代回k+b=6得b=3（学生误得b=9），解析式y=3x+3，代入A(-2,-3)验证-6+3=-3成立。【重点：求出k后应代回k+b=6求b，b=6-k=3，学生解b时计算出错且未回代检验】"},{"questionNo":"16","result":"正确","knowledgePoints":["坐标轴上点的坐标特征","第一象限坐标符号","点到坐标轴距离"],"studentAnswer":"(1)a=1/3；(2)A(4,5)","correctAnswer":"(1)a=1/3；(2)A(4,5)","solutionSummary":"(1)A在x轴上纵坐标3a-1=0，a=1/3；(2)第一象限2a>0、3a-1>0，距离和2a+3a-1=9，5a=10，a=2，A(4,5)，均正确。【重点：第一象限内距离即坐标本身，无需加绝对值】"},{"questionNo":"17","result":"部分正确","errorType":"计算","knowledgePoints":["平移作图","割补法求三角形面积","平移不改变面积"],"studentAnswer":"(1)画出A1B1C1；(2)面积写9，列式3×4-3×3×1/2-1×3×1/2=12-3=9","correctAnswer":"(1)平移图正确；(2)面积为6","solutionSummary":"A(-1,2)、B(3,2)、C(2,-1)，AB=4，高为3，面积=1/2×4×3=6；学生割补时三角形面积算错（3×3×1/2=4.5而非3）且漏减第二个小三角形。【重点：割补法中每个角三角形都要算1/2底×高，平移前后面积不变，可用底乘高直接验证】"},{"questionNo":"18","result":"部分正确","errorType":"方法","knowledgePoints":["新定义运算","两点间距离","绝对值方程"],"studentAnswer":"(1)P'(-3,7)正确；(2)空白未答","correctAnswer":"(1)(-3,7)；(2)k=±2","solutionSummary":"(1)(3+3×(-2),3×3+(-2))=(-3,7)正确；(2)设P(a,0)a>0，P'=(a,ka)，PP'=|ka|=2a得|k|=2，k=±2，第(2)问未作答。【重点：新定义直接套公式即可，长度要用绝对值，|k|=2对应k=2和k=-2两个解】}]}`;

test("parses a real external-AI paste with malformed knowledgePoints and a truncated tail", () => {
  const result = parseExternalReview(USER_PASTED);
  assert.equal(result.review.length, 18);
  assert.deepEqual(
    result.review.find((q) => q.questionNo === "3").knowledgePoints,
    ["直线平行于坐标轴的坐标特征", "垂线段最短", "最短距离问题"]
  );
  const q18 = result.review.find((q) => q.questionNo === "18");
  assert.ok(q18.solutionSummary.includes("【重点：新定义直接套公式即可"));
  assert.ok(!q18.solutionSummary.includes("}"));
  assert.equal(result.review.filter((q) => q.solutionSummary.includes("【重点：")).length, 18);
  assert.deepEqual(
    result.review.reduce((counts, q) => { counts[q.result] = (counts[q.result] || 0) + 1; return counts; }, {}),
    { "正确": 7, "错误": 7, "未作答": 2, "部分正确": 2 }
  );
});

test("collapses double-escaped backslashes so KaTeX does not treat them as line breaks", () => {
  // AI 在 JSON 里输出 "\\\\geqslant"（双重转义）时，解析后是 \\geqslant，
  // KaTeX 会把 \\ 当换行、把 geqslant 渲染成普通文本——必须归一成单反斜杠
  const result = parseExternalReview('{"questions":[{"questionNo":"1","result":"正确","studentAnswer":"点$P(-2,5)$","correctAnswer":"$|x|=\\\\\\\\|-2|$","solutionSummary":"$x\\\\\\\\geqslant-3$【重点：横纵坐标勿混淆】"}]}');
  assert.equal(result.review[0].solutionSummary, "$x\\geqslant-3$【重点：横纵坐标勿混淆】");
  assert.equal(result.review[0].correctAnswer, "$|x|=\\|-2|$");
  assert.ok(!result.review[0].solutionSummary.includes("\\\\"));
});

test("normalizes Doubao-style \\(...\\) delimiters, stray parens, and keeps cases rows intact", () => {
  // 豆包常用 \(...\) 定界符，且 $ 与 \( 混用时配对错位会留下 \( \) 残片
  const result = parseExternalReview(JSON.stringify({ questions: [
    {
      questionNo: "15", result: "错误", errorType: "计算",
      knowledgePoints: ["待定系数法"],
      studentAnswer: "列对方程组，解得\\(k = 3\\)、\\(b = 9\\)，写\\(y = 3x + 9\\)",
      correctAnswer: "y = 3x + 3",
      solutionSummary: "①把两点代入\\(y = kx + b\\)。②\\(\\begin{cases}-2k+b=-3\\\\k+b=6\\end{cases}\\)两式相减得\\(k = 3\\)，故\\(y = 3x + 3\\)。【重点：求出k后应代回验证】"
    }
  ] }));
  const q = result.review[0];
  assert.equal(q.studentAnswer, "列对方程组，解得$k = 3$、$b = 9$，写$y = 3x + 9$");
  assert.equal(q.solutionSummary.includes("\\begin{cases}"), true, "cases 环境保留");
  assert.equal(q.solutionSummary.includes("\\\\begin"), false);
  assert.equal(q.solutionSummary.includes("\\\\k+b"), true, "cases 行分隔符保留");
  assert.equal(q.solutionSummary.includes("【重点：求出k后应代回验证】"), true);
});

test("cleans stray \\( \\) inside $...$ spans without breaking content", () => {
  const result = parseExternalReview('{"questions":[{"questionNo":"1","result":"正确","studentAnswer":"选A，点$P\\(-2,5\\)$到y轴距离","correctAnswer":"A，距离为$\\\\|x|"}]}');
  const q = result.review[0];
  assert.equal(q.studentAnswer.includes("点$P(-2,5)$"), true);
  assert.equal(q.studentAnswer.includes("\\("), false);
  assert.equal(q.correctAnswer.includes("\\("), false);
});

test("handles nested \\( \\) parens inside Doubao's \\(...\\) math delimiters (Q17 case)", () => {
  // 豆包把公式包在 \(...\) 里，公式内部的括号也写成 \( \)——需要深度计数配对
  const result = parseExternalReview(JSON.stringify({ questions: [{
    questionNo: "17", result: "部分正确", errorType: "计算", knowledgePoints: ["割补法"],
    studentAnswer: "(1)画出\\(A_1B_1C_1\\)；(2)面积写9，列式\\(3\\times4-3\\times3\\times\\(\\)\\frac12\\(\\)-1\\times3\\times\\(\\)\\frac12\\(\\)=(\\()12-3(\\)=(\\)9\\)",
    correctAnswer: "(1)平移图正确；(2)面积为6",
    solutionSummary: "①由网格读\\(A(-1,2)\\)、\\(B(3,2)\\)、\\(C(2,-1)\\)，可用底乘高。②\\(AB = 4\\)，\\(S = \\frac12\\times4\\times3 = 6\\)。【重点：每个角三角形都要乘\\(\\frac12\\)】"
  }] }));
  const q = result.review[0];
  // 公式整体并入 $...$（内层括号还原），长公式尾部因原文转义汤尽力切分
  assert.equal(q.studentAnswer.startsWith("(1)画出$A_1B_1C_1$；(2)面积写9，列式$3\\times4-3\\times3\\times()\\frac12()"), true);
  assert.equal(q.solutionSummary.includes("$A(-1,2)$"), true);
  assert.equal(q.solutionSummary.includes("$S = \\frac12\\times4\\times3 = 6$"), true);
  assert.equal(q.solutionSummary.includes("【重点：每个角三角形都要乘$\\frac12$】"), true);
});
