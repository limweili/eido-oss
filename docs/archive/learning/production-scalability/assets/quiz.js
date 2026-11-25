function checkQuiz(quizId) {
  const quiz = document.getElementById(quizId);
  if (!quiz) return;

  const questions = Array.from(quiz.querySelectorAll(".quiz-question"));
  let correct = 0;

  for (const question of questions) {
    const checked = question.querySelector("input[type='radio']:checked");
    const feedback = question.querySelector(".feedback");
    const expected = question.getAttribute("data-correct");
    const note = question.getAttribute("data-note") || "";

    if (!feedback || !expected) continue;

    if (checked && checked.value === expected) {
      correct += 1;
      feedback.className = "feedback correct";
      feedback.textContent = "Correct. " + note;
    } else {
      feedback.className = "feedback incorrect";
      feedback.textContent = "Try again. " + note;
    }
  }

  const score = quiz.querySelector(".quiz-score");
  if (score) {
    score.textContent = correct + " of " + questions.length + " correct.";
  }
}
