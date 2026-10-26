const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveTrainingProgress } = require("./training-progress.cjs");

test("counts an approved training complete only after a linked review is confirmed", () => {
  const trainings = [
    { id: "approved", status: "approved" },
    { id: "draft", status: "draft" },
    { id: "unused", status: "approved" }
  ];
  const answers = [
    { trainingId: "approved", reviewStatus: "draft" },
    { trainingId: "draft", reviewStatus: "confirmed" },
    { trainingId: "approved", reviewStatus: "confirmed" }
  ];

  const result = deriveTrainingProgress(trainings, answers);
  assert.equal(result.completedCount, 1);
  assert.deepEqual(result.trainings.map((item) => item.progress), [
    { linkedCount: 2, confirmedCount: 1, complete: true },
    { linkedCount: 1, confirmedCount: 1, complete: false },
    { linkedCount: 0, confirmedCount: 0, complete: false }
  ]);
});

test("recalculates completion after linked answers are removed", () => {
  const trainings = [{ id: "exercise", status: "approved" }];
  const confirmedAnswer = { trainingId: "exercise", reviewStatus: "confirmed" };
  assert.equal(deriveTrainingProgress(trainings, [confirmedAnswer]).completedCount, 1);
  assert.equal(deriveTrainingProgress(trainings, []).completedCount, 0);
});
