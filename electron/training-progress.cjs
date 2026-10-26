function deriveTrainingProgress(trainings, answers) {
  const answerRows = Array.isArray(answers) ? answers : [];
  const rows = (Array.isArray(trainings) ? trainings : []).map((training) => {
    const linked = answerRows.filter((answer) => answer.trainingId === training.id);
    const confirmedCount = linked.filter((answer) => answer.reviewStatus === "confirmed").length;
    const complete = training.status === "approved" && confirmedCount > 0;
    return {
      ...training,
      progress: {
        linkedCount: linked.length,
        confirmedCount,
        complete
      }
    };
  });
  return {
    trainings: rows,
    completedCount: rows.filter((training) => training.progress.complete).length
  };
}

module.exports = { deriveTrainingProgress };
