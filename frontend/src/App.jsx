import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getLearnerId } from './api.js';
import { buildResultsExport, DISCLAIMER } from './export.js';

const ACTIVE_QUIZ_KEY = 'az900-active-quiz';
const DOMAIN_COLORS = ['mint', 'blue', 'gold'];

function readTheme() {
  const saved = localStorage.getItem('az900-theme');
  return saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function App() {
  const [theme, setTheme] = useState(readTheme);
  const [learnerId] = useState(getLearnerId);
  const [topics, setTopics] = useState([]);
  const [health, setHealth] = useState(null);
  const [attempts, setAttempts] = useState(null);
  const [page, setPage] = useState('home');
  const [quiz, setQuiz] = useState(null);
  const [results, setResults] = useState(null);
  const [allResults, setAllResults] = useState(null);
  const [reviewFilter, setReviewFilter] = useState('all');
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [selectedTopics, setSelectedTopics] = useState([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [healthData, topicData] = await Promise.all([api.getHealth(), api.getTopics()]);
      setHealth(healthData);
      setTopics(topicData.domains);
      const history = await api.getAttempts(learnerId);
      setAttempts(history);
      return { healthData, topicData };
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [learnerId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('az900-theme', theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const dashboard = await refreshDashboard();
      if (!mounted || !dashboard) return;
      const saved = sessionStorage.getItem(ACTIVE_QUIZ_KEY);
      if (!saved) return;
      try {
        const cached = JSON.parse(saved);
        const current = await api.getQuestion(cached.sessionId);
        if (!mounted) return;
        if (current.progress.finished) {
          const resultData = await api.getResults(cached.sessionId);
          if (!mounted) return;
          setResults(resultData);
          setQuiz(cached);
          setPage('results');
          return;
        }
        const questions = current.question && !cached.questions.some((q) => q.id === current.question.id)
          ? [...cached.questions, current.question]
          : cached.questions;
        const restored = { ...cached, questions, progress: current.progress };
        setQuiz(restored);
        sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(restored));
        setPage('quiz');
        setNotice('Your in-progress quiz was restored.');
      } catch (restoreError) {
        sessionStorage.removeItem(ACTIVE_QUIZ_KEY);
        if (restoreError.code === 'SESSION_NOT_FOUND') {
          setNotice('Your previous quiz session expired. Start a new quiz to continue practising.');
        } else {
          setError(restoreError.message);
        }
      }
    })();
    return () => { mounted = false; };
  }, [refreshDashboard]);

  const maxAvailable = useMemo(() => {
    let selected = selectedDomains.length
      ? topics.filter((domain) => selectedDomains.includes(domain.id))
      : topics;
    if (selectedTopics.length) {
      const topicDomains = topics.filter((domain) => domain.topics.some((topic) => selectedTopics.includes(topic.name)));
      selected = selected.filter((domain) => topicDomains.some((item) => item.id === domain.id));
    }
    return selected.reduce((total, domain) => total + domain.questionCount, 0);
  }, [selectedDomains, selectedTopics, topics]);

  const countOptions = useMemo(() => {
    if (!maxAvailable) return [];
    return [...new Set([5, 10, 15, 20, 25, maxAvailable].filter((count) => count <= maxAvailable))].sort((a, b) => a - b);
  }, [maxAvailable]);

  useEffect(() => {
    if (countOptions.length && !countOptions.includes(questionCount)) {
      setQuestionCount(countOptions[countOptions.length - 1]);
    }
  }, [countOptions, questionCount]);

  function updateQuiz(next) {
    setQuiz(next);
    sessionStorage.setItem(ACTIVE_QUIZ_KEY, JSON.stringify(next));
  }

  function handleSessionError(requestError) {
    if (requestError.code === 'SESSION_NOT_FOUND') {
      sessionStorage.removeItem(ACTIVE_QUIZ_KEY);
      setQuiz(null);
      setResults(null);
      setAllResults(null);
      setPage('home');
      setError('');
      setNotice('This quiz session has expired. Start a new quiz to continue practising.');
      return;
    }
    setError(requestError.message);
  }

  function toggleDomain(id) {
    const turningOff = selectedDomains.includes(id);
    setSelectedDomains((current) => turningOff ? current.filter((item) => item !== id) : [...current, id]);
    if (turningOff) {
      const domain = topics.find((item) => item.id === id);
      if (domain) setSelectedTopics((current) => current.filter((name) => !domain.topics.some((topic) => topic.name === name)));
    }
  }

  function toggleTopic(name) {
    setSelectedTopics((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  async function startQuiz() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const options = { count: Math.min(questionCount, maxAvailable) };
      if (selectedDomains.length) options.domains = selectedDomains;
      if (selectedTopics.length) options.topics = selectedTopics;
      const started = await api.startSession(options, learnerId);
      const nextQuiz = {
        sessionId: started.sessionId,
        questions: [started.question],
        answers: {},
        drafts: {},
        index: 0,
        progress: started.progress,
        startedAt: new Date().toISOString(),
        domains: selectedDomains,
        topics: selectedTopics,
        requestedCount: options.count,
      };
      updateQuiz(nextQuiz);
      setResults(null);
      setAllResults(null);
      setPage('quiz');
    } catch (requestError) {
      handleSessionError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    const question = quiz?.questions[quiz.index];
    const draft = question && quiz.drafts[question.id];
    if (!question || !draft?.choiceId || quiz.answers[question.id]) return;
    setBusy(true);
    setError('');
    try {
      const feedback = await api.submitAnswer(quiz.sessionId, {
        questionId: question.id,
        choiceId: draft.choiceId,
        confidence: draft.confidence || 'sure',
      });
      const questions = feedback.nextQuestion
        ? [...quiz.questions.filter((item) => item.id !== feedback.nextQuestion.id), feedback.nextQuestion]
        : quiz.questions;
      updateQuiz({
        ...quiz,
        questions,
        answers: { ...quiz.answers, [question.id]: { choiceId: draft.choiceId, confidence: draft.confidence || 'sure', feedback } },
        progress: feedback.progress,
      });
    } catch (requestError) {
      handleSessionError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function loadResults() {
    setBusy(true);
    setError('');
    try {
      const data = await api.getResults(quiz.sessionId);
      setResults(data);
      setAllResults(data);
      setReviewFilter('all');
      setPage('results');
      sessionStorage.removeItem(ACTIVE_QUIZ_KEY);
      const history = await api.getAttempts(learnerId);
      setAttempts(history);
    } catch (requestError) {
      handleSessionError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function changeReviewFilter(filter) {
    if (!quiz) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.getResults(quiz.sessionId, filter);
      setResults(data);
      setReviewFilter(filter);
    } catch (requestError) {
      handleSessionError(requestError);
    } finally {
      setBusy(false);
    }
  }

  function leaveQuiz() {
    if (page === 'quiz' && !quiz?.progress.finished && !window.confirm('Leave this quiz? Your answers so far will be kept in this browser, but you can’t change submitted answers.')) return;
    setPage('home');
    setError('');
    setNotice('');
  }

  function selectAnswer(questionId, choiceId) {
    if (quiz.answers[questionId]) return;
    updateQuiz({
      ...quiz,
      drafts: {
        ...quiz.drafts,
        [questionId]: { ...quiz.drafts[questionId], choiceId },
      },
    });
  }

  function setConfidence(questionId, confidence) {
    updateQuiz({
      ...quiz,
      drafts: {
        ...quiz.drafts,
        [questionId]: { ...quiz.drafts[questionId], confidence },
      },
    });
  }

  function goToQuestion(index) {
    if (!quiz || index < 0 || index >= quiz.questions.length) return;
    updateQuiz({ ...quiz, index });
  }

  useEffect(() => {
    if (page !== 'quiz' || !quiz) return undefined;
    function handleKey(event) {
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
      if (event.key === 'ArrowLeft' && quiz.index > 0) {
        event.preventDefault();
        goToQuestion(quiz.index - 1);
      }
      if (event.key === 'ArrowRight' && quiz.answers[quiz.questions[quiz.index]?.id] && quiz.index < quiz.questions.length - 1) {
        event.preventDefault();
        goToQuestion(quiz.index + 1);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [page, quiz]);

  function exportResults() {
    const fullResults = allResults || results;
    if (!fullResults) return;
    try {
      const exportData = buildResultsExport(fullResults, quiz);
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `az900-quiz-results-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      handleSessionError(requestError);
    }
  }

  return (
    <div className="app-shell">
      <Header theme={theme} onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} onHome={leaveQuiz} />
      <main id="main-content">
        {error && <div className="alert alert-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => page === 'home' ? refreshDashboard() : setError('')}>{page === 'home' ? 'Retry' : 'Dismiss'}</button></div>}
        {notice && <div className="alert alert-note" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
        {page === 'home' && (
          <Dashboard
            loading={loading} health={health} topics={topics} attempts={attempts} selectedDomains={selectedDomains}
            selectedTopics={selectedTopics} onToggleDomain={toggleDomain} onToggleTopic={toggleTopic}
            countOptions={countOptions} questionCount={questionCount} setQuestionCount={setQuestionCount}
            busy={busy} onStart={startQuiz} onResume={() => setPage('quiz')}
            hasActiveQuiz={Boolean(quiz && !quiz.progress.finished)}
          />
        )}
        {page === 'quiz' && quiz && (
          <QuizPage
            quiz={quiz} busy={busy} onSelect={selectAnswer} onConfidence={setConfidence}
            onSubmit={submitAnswer} onNavigate={goToQuestion} onResults={loadResults} onExit={leaveQuiz}
          />
        )}
        {page === 'results' && results && (
          <ResultsPage
            results={results} filter={reviewFilter} busy={busy} onFilter={changeReviewFilter}
            onExport={exportResults} onHome={() => { setPage('home'); setError(''); }} onRestart={() => { setPage('home'); setError(''); }}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Header({ theme, onTheme, onHome }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={onHome} aria-label="AZ-900 Smart Quiz Builder home">
        <span className="brand-mark" aria-hidden="true"><span>✓</span></span>
        <span className="brand-copy"><strong>smartquiz</strong><small>AZ-900 practice</small></span>
      </button>
      <nav className="header-nav" aria-label="Main navigation">
        <span className="nav-caption">LEARN WITH PURPOSE</span>
        <button className="theme-toggle" onClick={onTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span className="theme-label">{theme === 'dark' ? 'Light' : 'Dark'} mode</span>
        </button>
      </nav>
    </header>
  );
}

function Dashboard({ loading, health, topics, attempts, selectedDomains, selectedTopics, onToggleDomain, onToggleTopic, countOptions, questionCount, setQuestionCount, busy, onStart, onResume, hasActiveQuiz }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR AZURE FUNDAMENTALS STUDY SPACE</div>
          <h1>Build confidence.<br /><span>One question at a time.</span></h1>
          <p className="hero-description">Practice the concepts that matter, understand every answer, and see where to focus next — without the guesswork.</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#quiz-builder">Build your practice quiz <span aria-hidden="true">→</span></a>
            {hasActiveQuiz && <button className="button button-secondary" onClick={onResume}>Resume quiz</button>}
          </div>
          <p className="hero-footnote"><span aria-hidden="true">✳</span> Original learning questions · Explanations after every answer</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="art-card art-card-main"><div className="art-card-top"><span className="art-icon">✦</span><span>YOUR LEARNING PATH</span></div><strong>Small steps,<br />real progress.</strong><div className="art-progress"><span /></div><div className="art-card-bottom"><span>Keep building your skills</span><span>↗</span></div></div>
          <div className="art-stamp">LEARN<br />& GROW <span>✳</span></div>
          <div className="art-pill"><span className="pill-dot" /> Practice, reflect, repeat</div>
        </div>
      </section>

      <section className="stat-strip" aria-label="Practice overview">
        <Stat value={loading ? '—' : health?.questions ?? '—'} label="Original questions" icon="✳" />
        <Stat value={loading ? '—' : topics.length || '—'} label="Learning domains" icon="⌁" />
        <Stat value={loading ? '—' : attempts?.stats?.attemptCount ?? 0} label="Your completed quizzes" icon="↗" />
        <div className="stat-message"><span className="status-indicator" /> Every answer is a chance to learn</div>
      </section>

      <section className="builder-section" id="quiz-builder">
        <div className="section-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h2>What would you like to practise?</h2></div><span className="step-tag">01 <span>—</span> SET UP YOUR QUIZ</span></div>
        <div className="builder-grid">
          <div className="domain-panel">
            <div className="panel-heading"><div><h3>Choose your learning domains</h3><p>Select one, a few, or leave them open for a mixed quiz.</p></div><span className="optional-tag">OPTIONAL</span></div>
            {loading && <div className="loading-line">Loading domains from the practice API…</div>}
            {!loading && topics.length === 0 && <div className="empty-inline">Domain information is unavailable. Check the API connection and retry.</div>}
            <div className="domain-list">
              {topics.map((domain, index) => (
                <div className="domain-group" key={domain.id}>
                  <button className={`domain-option ${selectedDomains.includes(domain.id) ? 'selected' : ''}`} aria-pressed={selectedDomains.includes(domain.id)} onClick={() => onToggleDomain(domain.id)}>
                    <span className={`domain-symbol ${DOMAIN_COLORS[index % DOMAIN_COLORS.length]}`} aria-hidden="true">{['◌', '⌘', '✳'][index % 3]}</span>
                    <span className="domain-name"><strong>{domain.name.replace(/^Describe /, '')}</strong><small>{domain.topics.map((topic) => topic.name).join(' · ')}</small></span>
                    <span className="domain-count">{domain.questionCount} questions</span>
                    <span className={`check-box ${selectedDomains.includes(domain.id) ? 'checked' : ''}`} aria-hidden="true">{selectedDomains.includes(domain.id) ? '✓' : ''}</span>
                  </button>
                  <div className="topic-chips" aria-label={`Topics in ${domain.name}`}>
                    {domain.topics.map((topic) => <button type="button" className={`topic-chip ${selectedTopics.includes(topic.name) ? 'topic-chip-active' : ''}`} key={topic.name} aria-pressed={selectedTopics.includes(topic.name)} disabled={selectedDomains.length > 0 && !selectedDomains.includes(domain.id)} title={selectedDomains.length > 0 && !selectedDomains.includes(domain.id) ? 'Clear your domain selection to choose this topic.' : undefined} onClick={() => onToggleTopic(topic.name)}>{topic.name}<span>{topic.questionCount}</span></button>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <aside className="count-panel">
            <div className="count-panel-label"><span className="count-icon">↗</span> QUIZ LENGTH</div>
            <h3>Set your pace.</h3>
            <p>Choose a question count that fits your study session. You can’t change an answer after submitting it.</p>
            <label className="select-label" htmlFor="question-count">Questions in this quiz</label>
            <select id="question-count" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} disabled={!countOptions.length}>
              {countOptions.map((count) => <option key={count} value={count}>{count} questions</option>)}
            </select>
            <div className="count-availability">{selectedDomains.length ? `${maxAvailable} matching question${maxAvailable === 1 ? '' : 's'} available` : `${health?.questions ?? '—'} original questions in the question bank`}</div>
            <button className="button button-primary button-wide" onClick={onStart} disabled={busy || !topics.length || !countOptions.length}>
              {busy ? <><span className="spinner" /> Starting…</> : <>Start a quiz <span aria-hidden="true">→</span></>}
            </button>
            {hasActiveQuiz && <button className="button button-quiet button-wide" onClick={onResume}>Continue your active quiz</button>}
          </aside>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="how-card"><span className="eyebrow">A BETTER WAY TO PREPARE</span><h2>Practice that teaches,<br />not just tests.</h2><div className="how-steps"><HowStep number="01" title="Choose your focus" text="Mix domains or spend time on one area." /><HowStep number="02" title="Think it through" text="Answer in order and rate your confidence." /><HowStep number="03" title="Learn from it" text="Get clear explanations and a useful review." /></div></div>
        <div className="history-card"><div className="history-heading"><div><span className="eyebrow">YOUR JOURNEY</span><h3>Practice history</h3></div><span className="history-icon">↗</span></div>
          {loading ? <p className="history-empty">Loading your progress…</p> : attempts?.attempts?.length
            ? <div className="attempt-list">{attempts.attempts.slice(0, 3).map((attempt) => <div className="attempt-row" key={attempt.sessionId}><span className="attempt-date">{formatDate(attempt.completedAt)}</span><span className="attempt-score">{attempt.percent ?? '—'}%</span><span className="attempt-detail">{attempt.correct}/{attempt.totalQuestions} correct</span></div>)}</div>
            : <p className="history-empty">Your completed quizzes will appear here. Start a practice session to begin your learning history.</p>}
          {attempts?.stats?.bestPercent !== null && attempts?.stats?.bestPercent !== undefined && <div className="best-score">Best practice score <strong>{attempts.stats.bestPercent}%</strong></div>}
        </div>
      </section>
    </>
  );
}

function Stat({ value, label, icon }) {
  return <div className="stat-item"><span className="stat-icon">{icon}</span><span className="stat-copy"><strong>{value}</strong><small>{label}</small></span></div>;
}

function HowStep({ number, title, text }) {
  return <div className="how-step"><span className="step-number">{number}</span><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function QuizPage({ quiz, busy, onSelect, onConfidence, onSubmit, onNavigate, onResults, onExit }) {
  const question = quiz.questions[quiz.index];
  if (!question) return <section className="content-card"><h1>Question unavailable</h1><p>We couldn’t restore the current question. Return to the dashboard and start a new quiz.</p><button className="button button-primary" onClick={onExit}>Back to dashboard</button></section>;
  const answer = quiz.answers[question.id];
  const draft = quiz.drafts[question.id] || {};
  const progress = quiz.progress.total ? Math.round((quiz.progress.answered / quiz.progress.total) * 100) : 0;
  const nextReady = Boolean(answer && quiz.index < quiz.questions.length - 1);
  return (
    <section className="quiz-layout">
      <div className="quiz-topline"><button className="back-link" onClick={onExit}>← <span>Dashboard</span></button><div className="quiz-notice">UNOFFICIAL PRACTICE <span>·</span> ORIGINAL QUESTIONS</div></div>
      <div className="quiz-heading"><div><span className="eyebrow">{question.topic}</span><h1>Take your time.<br /><span>Think it through.</span></h1></div><div className="question-count"><strong>{quiz.index + 1}</strong><span>/ {quiz.progress.total}</span><small>QUESTION</small></div></div>
      <div className="progress-track" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax={quiz.progress.total} aria-valuenow={quiz.progress.answered}><span style={{ width: `${progress}%` }} /></div>
      <div className="quiz-body">
        <article className="question-card">
          <div className="question-meta"><span className="question-topic">{question.topic}</span><span>Question {quiz.index + 1} of {quiz.progress.total}</span></div>
          <h2>{question.question}</h2>
          <fieldset className="answer-options" disabled={Boolean(answer) || busy}>
            <legend className="sr-only">Choose your answer</legend>
            {question.choices.map((choice, index) => {
              const selected = answer?.choiceId === choice.id || (!answer && draft.choiceId === choice.id);
              const isCorrect = answer?.feedback.correctChoiceId === choice.id;
              const isWrongChoice = Boolean(answer && selected && !answer.feedback.correct);
              return <button type="button" className={`answer-option ${selected ? 'chosen' : ''} ${isCorrect ? 'answer-correct' : ''} ${isWrongChoice ? 'answer-wrong' : ''}`} key={choice.id} onClick={() => onSelect(question.id, choice.id)} aria-pressed={selected}>
                <span className="choice-letter">{String.fromCharCode(65 + index)}</span><span className="choice-text">{choice.text}</span>
                {isCorrect && <span className="answer-state">✓ Correct</span>}
                {isWrongChoice && <span className="answer-state">× Your answer</span>}
                {!answer && <span className={`radio-mark ${selected ? 'radio-selected' : ''}`} />}
              </button>;
            })}
          </fieldset>
          {!answer && <div className="confidence-row"><span>How confident are you?</span><div className="confidence-control" role="group" aria-label="Rate answer confidence">
            <button className={draft.confidence !== 'guessing' ? 'confidence-active' : ''} onClick={() => onConfidence(question.id, 'sure')} aria-pressed={draft.confidence !== 'guessing'}>● &nbsp;I’m sure</button>
            <button className={draft.confidence === 'guessing' ? 'confidence-active' : ''} onClick={() => onConfidence(question.id, 'guessing')} aria-pressed={draft.confidence === 'guessing'}>◌ &nbsp;I’m guessing</button>
          </div></div>}
          {answer && <Feedback feedback={answer.feedback} />}
          <div className="quiz-controls">
            <button className="button button-secondary" onClick={() => onNavigate(quiz.index - 1)} disabled={quiz.index === 0}>← Previous</button>
            {!answer
              ? <button className="button button-primary" onClick={onSubmit} disabled={!draft.choiceId || busy}>{busy ? <><span className="spinner" /> Submitting…</> : <>Submit answer <span aria-hidden="true">→</span></>}</button>
              : quiz.progress.finished
                ? <button className="button button-primary" onClick={onResults} disabled={busy}>{busy ? 'Loading results…' : <>See your results <span aria-hidden="true">→</span></>}</button>
                : <button className="button button-primary" onClick={() => onNavigate(quiz.index + 1)} disabled={!nextReady}>Next question <span aria-hidden="true">→</span></button>}
          </div>
        </article>
        <aside className="quiz-aside"><div className="aside-note"><span className="aside-star">✳</span><span className="eyebrow">A NOTE TO YOU</span><h3>There’s no rush.</h3><p>Read each question carefully. Learning is the point — your confidence rating helps make your review more useful.</p></div><div className="question-map"><h3>Your progress</h3><div className="question-dots">{Array.from({ length: quiz.progress.total }, (_, index) => <span key={index} className={`${index === quiz.index ? 'dot-current' : ''} ${index < quiz.progress.answered ? 'dot-answered' : ''}`} aria-label={`Question ${index + 1}${index < quiz.progress.answered ? ', answered' : ''}`} />)}</div><p>{quiz.progress.answered} of {quiz.progress.total} answered</p><button className="text-button finish-link" onClick={onExit}>Save and leave quiz</button></div><p className="aside-disclaimer">Unofficial AZ-900 practice. Not affiliated with Microsoft.</p></aside>
      </div>
      <p className="keyboard-tip">Tip: use ← and → arrow keys to revisit answered questions.</p>
    </section>
  );
}

function Feedback({ feedback }) {
  return <section className={`feedback-card ${feedback.correct ? 'feedback-good' : 'feedback-review'}`} aria-live="polite">
    <div className="feedback-heading"><span className="feedback-symbol">{feedback.correct ? '✓' : '↺'}</span><div><strong>{feedback.correct ? feedback.luckyGuess ? 'Correct — let’s review it again' : 'That’s right!' : 'Not quite — this is a chance to learn'}</strong>{feedback.note && <p>{feedback.note}</p>}{!feedback.correct && feedback.whyYourChoiceIsWrong && <p>{feedback.whyYourChoiceIsWrong}</p>}</div></div>
    <div className="explanation"><span className="eyebrow">THE EXPLANATION</span><p>{feedback.explanation || 'No explanation was provided for this question.'}</p></div>
    {feedback.learnMoreUrl && <a className="learn-more" href={feedback.learnMoreUrl} target="_blank" rel="noreferrer">Explore this topic on Microsoft Learn <span aria-hidden="true">↗</span></a>}
  </section>;
}

function ResultsPage({ results, filter, busy, onFilter, onExport, onHome }) {
  const readiness = results.readiness;
  const readinessLabel = { ready: 'Looking ready', almost: 'Almost there', 'not-yet': 'Keep practising', 'not-enough-data': 'More practice needed' }[readiness?.level] || 'Practice summary';
  return (
    <section className="results-layout">
      <div className="results-topline"><span className="eyebrow">YOUR PRACTICE SUMMARY</span><span className="quiz-notice">UNOFFICIAL PRACTICE · ORIGINAL QUESTIONS</span></div>
      <div className="results-hero"><div><span className="eyebrow">A MOMENT TO REFLECT</span><h1>Look how far<br /><span>you’ve come.</span></h1><p>Every practice session gives you a clearer picture of what you know and what to explore next.</p></div><div className="score-circle" aria-label={`${results.percent ?? 0} percent correct`}><strong>{results.percent ?? '—'}<small>{results.percent === null ? '' : '%'}</small></strong><span>PRACTICE<br />SCORE</span></div></div>
      <div className="result-summary">
        <div><strong>{results.correct}<small>/{results.totalQuestions}</small></strong><span>Correct answers</span></div>
        <div><strong>{results.answered}</strong><span>Questions answered</span></div>
        <div><strong>{results.mastered}</strong><span>Confidently mastered</span></div>
        <div><strong>{results.luckyGuesses}</strong><span>Lucky guesses to revisit</span></div>
      </div>
      <section className="readiness-panel"><div className={`readiness-badge readiness-${readiness?.level || 'unknown'}`}><span>✳</span>{readinessLabel}</div><div className="readiness-copy"><h2>Your indicative readiness</h2><p>{readiness?.message || 'Answer more questions to see an indicative practice estimate.'}</p><small>{readiness?.disclaimer || 'Based on practice answers only; not a prediction of your certification exam score.'}</small></div><div className="readiness-score"><strong>{readiness?.score ?? '—'}{readiness?.score === null || readiness?.score === undefined ? '' : '%'}</strong><span>READINESS</span></div></section>

      <section className="domain-results"><div className="section-heading compact-heading"><div><span className="eyebrow">WHERE YOU PRACTISED</span><h2>Domain breakdown</h2></div></div>
        <div className="domain-result-list">{results.byDomain.filter((domain) => domain.answered > 0).map((domain, index) => <div className="domain-result" key={domain.domain}><div className={`domain-result-mark ${DOMAIN_COLORS[index % DOMAIN_COLORS.length]}`}>{['◌', '⌘', '✳'][index % 3]}</div><div className="domain-result-copy"><strong>{domain.name}</strong><div className="result-progress"><span style={{ width: `${domain.percent ?? 0}%` }} /></div></div><span className="domain-result-count">{domain.correct}/{domain.answered}</span><strong className="domain-result-percent">{domain.percent ?? '—'}%</strong></div>)}
          {!results.byDomain.some((domain) => domain.answered > 0) && <p className="history-empty">No domain answers are available yet.</p>}
        </div>
        {readiness?.notCovered?.length > 0 && <p className="not-covered"><strong>Not covered in this quiz:</strong> {readiness.notCovered.join(' · ')}</p>}
      </section>

      <section className="review-section"><div className="review-heading"><div><span className="eyebrow">LEARN FROM EVERY ANSWER</span><h2>Review your practice</h2><p>Revisit the original explanations and reinforce what you’ve learned.</p></div><button className="button button-secondary" onClick={onExport}>↓ Export JSON</button></div>
        <div className="review-tabs" role="tablist" aria-label="Filter answer review">{[['all', 'All answers'], ['wrong', 'Incorrect'], ['lucky', 'Lucky guesses']].map(([value, label]) => <button key={value} className={filter === value ? 'tab-active' : ''} role="tab" aria-selected={filter === value} onClick={() => onFilter(value)}>{label}</button>)}</div>
        {busy && <p className="loading-line">Loading review…</p>}
        {!busy && results.review.length === 0 && <div className="empty-review"><span>✳</span><h3>{filter === 'wrong' ? 'No incorrect answers — lovely work!' : filter === 'lucky' ? 'No lucky guesses to revisit.' : 'No answers to review yet.'}</h3><p>Keep practising to build a useful learning history.</p></div>}
        <div className="review-list">{results.review.map((item, index) => <ReviewItem key={item.questionId} item={item} index={index} />)}</div>
      </section>
      <div className="results-actions"><button className="button button-secondary" onClick={onHome}>← Back to dashboard</button><button className="button button-primary" onClick={onHome}>Start another quiz <span aria-hidden="true">→</span></button></div>
    </section>
  );
}

function ReviewItem({ item, index }) {
  const yourChoice = item.choices.find((choice) => choice.id === item.yourChoiceId);
  const correctChoice = item.choices.find((choice) => choice.id === item.correctChoiceId);
  return <article className="review-item"><div className="review-item-heading"><span className={`review-number ${item.correct ? 'review-correct' : 'review-incorrect'}`}>{item.correct ? '✓' : '!'}</span><div><span className="eyebrow">{item.topic} · {item.domain}</span><h3>{index + 1}. {item.question}</h3></div></div>
    <div className="review-answer-grid"><p><span>Your answer</span><strong>{yourChoice?.text || 'Not recorded'}</strong></p><p><span>Correct answer</span><strong>{correctChoice?.text || 'Not available'}</strong></p></div>
    {item.whyYourChoiceIsWrong && <p className="review-why">{item.whyYourChoiceIsWrong}</p>}
    {item.explanation && <p className="review-explanation">{item.explanation}</p>}
    {item.luckyGuess && <span className="lucky-label">Lucky guess · revisit this topic</span>}
    {item.learnMoreUrl && <a className="learn-more" href={item.learnMoreUrl} target="_blank" rel="noreferrer">Learn more <span aria-hidden="true">↗</span></a>}
  </article>;
}

function Footer() {
  return <footer className="site-footer"><div className="footer-brand"><span className="brand-mark" aria-hidden="true"><span>✓</span></span><strong>smartquiz</strong></div><p>{DISCLAIMER}</p><span className="footer-tag">MADE FOR LEARNING, NOT FOR THE EXAM ROOM</span></footer>;
}

function formatDate(value) {
  if (!value) return 'Practice session';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Practice session' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export default App;
