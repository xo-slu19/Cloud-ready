import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getLearnerId } from './api.js';
import { buildResultsExport, DISCLAIMER } from './export.js';
import { describeReadinessChange, filterReview, getDomainName, safeExternalUrl } from './helpers.js';

const ACTIVE_QUIZ_KEY = 'az900-active-quiz';
const COMPLETED_RESULTS_KEY = 'az900-completed-results';
const DOMAIN_COLORS = ['mint', 'blue', 'gold'];

function readTheme() {
  const saved = localStorage.getItem('az900-theme');
  return saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function App() {
  const [theme, setTheme] = useState(readTheme);
  const [fontScale, setFontScale] = useState(localStorage.getItem('az900-font-scale') || 'standard');
  const [highContrast, setHighContrast] = useState(localStorage.getItem('az900-high-contrast') === 'true');
  const [preview, setPreview] = useState('desktop');
  const [focusMode, setFocusMode] = useState(false);
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
  const [waking, setWaking] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState('');
  const busyRef = useRef(false);

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
      if (requestError.code === 'NETWORK_ERROR') {
        setError('The practice server is unavailable or still starting. Check that it is running, then retry.');
      } else if (requestError.code === 'TIMEOUT') {
        setError('The practice server took too long to respond. It may still be waking up; wait a moment, then retry.');
      } else {
        setError(requestError.message);
      }
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
    document.documentElement.dataset.contrast = highContrast ? 'high' : 'normal';
    localStorage.setItem('az900-high-contrast', String(highContrast));
  }, [highContrast]);

  useEffect(() => {
    document.documentElement.dataset.fontScale = fontScale;
    localStorage.setItem('az900-font-scale', fontScale);
  }, [fontScale]);

  useEffect(() => {
    if (preview === 'desktop') {
      delete document.body.dataset.previewActive;
    } else {
      document.body.dataset.previewActive = preview;
    }
    return () => { delete document.body.dataset.previewActive; };
  }, [preview]);

  useEffect(() => {
    if (!loading) {
      setWaking(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setWaking(true), 3500);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const dashboard = await refreshDashboard();
      if (!mounted || !dashboard) return;
      const completed = sessionStorage.getItem(COMPLETED_RESULTS_KEY);
      if (completed) {
        try {
          const restored = JSON.parse(completed);
          setQuiz(restored.quiz);
          setResults(restored.results);
          setAllResults(restored.results);
          setReviewFilter(['all', 'wrong', 'lucky'].includes(restored.filter) ? restored.filter : 'all');
          setPage('results');
          setFocusMode(false);
          return;
        } catch {
          sessionStorage.removeItem(COMPLETED_RESULTS_KEY);
        }
      }
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
          setAllResults(resultData);
          setQuiz(cached);
          setReviewFilter('all');
          setPage('results');
          persistCompletedResults(cached, resultData);
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
    const supportedMaximum = Math.min(maxAvailable, 50);
    if (!supportedMaximum) return [];
    return [...new Set([5, 10, 15, 20, 25, supportedMaximum].filter((count) => count <= supportedMaximum))].sort((a, b) => a - b);
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
      sessionStorage.removeItem(COMPLETED_RESULTS_KEY);
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

  async function createQuiz(options) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
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
        selectionAvailable: true,
      };
      updateQuiz(nextQuiz);
      setResults(null);
      setAllResults(null);
      sessionStorage.removeItem(COMPLETED_RESULTS_KEY);
      setFocusMode(false);
      setPage('quiz');
    } catch (requestError) {
      if (requestError.code === 'NETWORK_ERROR' || requestError.code === 'TIMEOUT') {
        setError('The server may be waking up or temporarily unavailable. No quiz was started. Wait a moment, then retry.');
      } else {
        setError(requestError.message);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function startQuiz() {
    const options = { count: Math.min(questionCount, maxAvailable) };
    if (selectedDomains.length) options.domains = selectedDomains;
    if (selectedTopics.length) options.topics = selectedTopics;
    return createQuiz(options);
  }

  function startPracticeSet(practiceSet) {
    if (!practiceSet || !Number.isInteger(practiceSet.count) || practiceSet.count < 1
      || (!practiceSet.domains?.length && !practiceSet.topics?.length)) {
      setError('A focused practice set is not available for this result. You can start a new mixed quiz instead.');
      return;
    }
    return createQuiz(practiceSet);
  }

  async function submitAnswer() {
    const question = quiz?.questions[quiz.index];
    const draft = question && quiz.drafts[question.id];
    if (!question || !draft?.choiceId || quiz.answers[question.id] || busyRef.current) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function loadResults() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await api.getResults(quiz.sessionId);
      setResults(data);
      setAllResults(data);
      setReviewFilter('all');
      setPage('results');
      setFocusMode(false);
      sessionStorage.removeItem(ACTIVE_QUIZ_KEY);
      persistCompletedResults(quiz, data);
      const history = await api.getAttempts(learnerId);
      setAttempts(history);
    } catch (requestError) {
      handleSessionError(requestError);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function changeReviewFilter(filter) {
    setReviewFilter(filter);
    if (quiz && allResults) persistCompletedResults(quiz, allResults, filter);
  }

  async function openHistoryAttempt(attempt, filter = 'all') {
    if (busyRef.current || !attempt?.sessionId) return;
    busyRef.current = true;
    setHistoryBusyId(attempt.sessionId);
    setBusy(true);
    setError('');
    try {
      const data = await api.getResults(attempt.sessionId);
      if (filter === 'practice') {
        busyRef.current = false;
        setHistoryBusyId('');
        setBusy(false);
        await startPracticeSet(data.recommendations?.practiceSet);
        return;
      }
      const historyQuiz = {
        sessionId: attempt.sessionId,
        domains: data.byDomain.filter((domain) => domain.answered > 0).map((domain) => domain.domain),
        topics: [...new Set(data.review.map((item) => item.topic))],
        requestedCount: data.totalQuestions,
        selectionAvailable: false,
      };
      if (filter === 'export') {
        downloadResults(data, historyQuiz);
        return;
      }
      setQuiz(historyQuiz);
      setAllResults(data);
      setResults(data);
      setReviewFilter(filter);
      persistCompletedResults(historyQuiz, data, filter);
      setPage('results');
    } catch (requestError) {
      if (requestError.code === 'SESSION_NOT_FOUND') {
        setError('Detailed results are no longer available because this backend keeps quiz sessions in memory. Its history entry may have expired too.');
      } else {
        setError(requestError.message);
      }
    } finally {
      busyRef.current = false;
      setHistoryBusyId('');
      setBusy(false);
    }
  }

  function leaveQuiz() {
    if (page === 'quiz' && !quiz?.progress.finished && !window.confirm('Leave this quiz? Your answers so far will be kept in this browser, but you can’t change submitted answers.')) return;
    setPage('home');
    setFocusMode(false);
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
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target.closest('input, textarea, select, summary, [role="menu"], [role="menuitem"], [role="tab"], [role="dialog"], [contenteditable="true"]')) return;
      if (event.target.closest('button') && !event.target.closest('.quiz-controls')) return;
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
      downloadResults(fullResults, quiz);
    } catch (requestError) {
      setError(`Could not export the results: ${requestError.message}`);
    }
  }

  return (
    <div className={`app-shell ${focusMode ? 'focus-mode' : ''}`} data-preview={preview} data-font-scale={fontScale}>
      <Header
        theme={theme} onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} onHome={leaveQuiz}
        fontScale={fontScale}
        setFontScale={setFontScale} highContrast={highContrast} setHighContrast={setHighContrast}
        preview={preview} setPreview={setPreview} focusMode={focusMode} setFocusMode={setFocusMode}
        showFocusMode={page === 'quiz'}
      />
      {preview !== 'desktop' && <div className="preview-notice" role="status">Responsive preview: {preview}. This changes the app preview width, not your device.</div>}
      <a className="skip-link" href="#main-content">Skip to content</a>
      <main id="main-content">
        {error && <div className="alert alert-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => page === 'home' ? refreshDashboard() : setError('')}>{page === 'home' ? 'Retry' : 'Dismiss'}</button></div>}
        {notice && <div className="alert alert-note" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
        {page === 'home' && (
          <Dashboard
            loading={loading} waking={waking} health={health} topics={topics} attempts={attempts} selectedDomains={selectedDomains}
            selectedTopics={selectedTopics} onToggleDomain={toggleDomain} onToggleTopic={toggleTopic}
            countOptions={countOptions} questionCount={questionCount} setQuestionCount={setQuestionCount}
            maxAvailable={maxAvailable}
            busy={busy} onStart={startQuiz} onResume={() => setPage('quiz')}
            onOpenAttempt={openHistoryAttempt} historyBusyId={historyBusyId}
            hasActiveQuiz={Boolean(quiz && !quiz.progress?.finished)}
          />
        )}
        {page === 'quiz' && quiz && (
          <QuizPage
            quiz={quiz} busy={busy} onSelect={selectAnswer} onConfidence={setConfidence}
            onSubmit={submitAnswer} onNavigate={goToQuestion} onResults={loadResults} onExit={leaveQuiz}
            focusMode={focusMode} onToggleFocus={() => setFocusMode((current) => !current)}
          />
        )}
        {page === 'results' && results && (
          <ResultsPage
            results={results} filter={reviewFilter} busy={busy} onFilter={changeReviewFilter}
            allResults={allResults || results} topics={topics}
            onExport={exportResults} onHome={() => {
              sessionStorage.removeItem(COMPLETED_RESULTS_KEY);
              sessionStorage.removeItem(ACTIVE_QUIZ_KEY);
              setResults(null);
              setAllResults(null);
              setQuiz(null);
              setPage('home');
              setError('');
            }}
            onRestart={startQuiz} onPractice={startPracticeSet}
            answerFeedback={quiz?.answers || {}}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Header({ theme, onTheme, onHome, fontScale, setFontScale, highContrast, setHighContrast, preview, setPreview, focusMode, setFocusMode, showFocusMode }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={onHome} aria-label="CloudReady home">
        <span className="brand-mark" aria-hidden="true"><span>✓</span></span>
        <span className="brand-copy"><strong>CloudReady</strong><small>AZ-900 practice</small></span>
      </button>
      <nav className="header-nav" aria-label="Main navigation">
        <span className="nav-caption">LEARN WITH PURPOSE</span>
        {showFocusMode && <button className="button button-secondary focus-toggle" onClick={() => setFocusMode((current) => !current)}>{focusMode ? 'Exit Focus Mode' : 'Focus Mode'}</button>}
        <details className="settings-menu">
          <summary aria-label="Open settings">Settings</summary>
          <div className="settings-panel">
            <section><strong>Appearance</strong><div className="settings-button-row">
              <button className={theme === 'light' ? 'setting-selected' : ''} onClick={() => theme !== 'light' && onTheme()}>Light</button>
              <button className={theme === 'dark' ? 'setting-selected' : ''} onClick={() => theme !== 'dark' && onTheme()}>Dark</button>
            </div></section>
            <section><strong>Text size</strong><div className="settings-button-row">
              {['standard', 'large'].map((size) => <button key={size} className={fontScale === size ? 'setting-selected' : ''} aria-pressed={fontScale === size} onClick={() => setFontScale(size)}>{size === 'standard' ? 'Standard' : 'Large'}</button>)}
            </div></section>
            <section><strong>Contrast</strong><button className="settings-check" aria-pressed={highContrast} onClick={() => setHighContrast(!highContrast)}>{highContrast ? '✓ High contrast on' : 'Enable high contrast'}</button></section>
            <section><strong>Language</strong><p className="settings-note">English · only available interface language</p></section>
            <section><strong>Responsive preview</strong><div className="settings-button-row">
              {['desktop', 'tablet', 'mobile'].map((size) => <button key={size} className={preview === size ? 'setting-selected' : ''} aria-pressed={preview === size} onClick={() => setPreview(size)}>{size[0].toUpperCase() + size.slice(1)}</button>)}
            </div><p className="settings-note">Preview width only; your device size is unchanged.</p></section>
          </div>
        </details>
      </nav>
    </header>
  );
}

function Dashboard({ loading, waking, health, topics, attempts, selectedDomains, selectedTopics, onToggleDomain, onToggleTopic, countOptions, questionCount, setQuestionCount, maxAvailable, busy, onStart, onResume, onOpenAttempt, historyBusyId, hasActiveQuiz }) {
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
      {loading && waking && <div className="waking-banner" role="status"><span className="spinner" /> Waking up the practice server. This can take up to a minute on a free host; please wait.</div>}

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
        <div className="history-card"><div className="history-heading"><div><span className="eyebrow">YOUR JOURNEY</span><h3>Quiz history</h3></div><span className="history-icon">↗</span></div>
          {loading ? <p className="history-empty">Loading your progress…</p> : attempts?.attempts?.length
            ? <div className="attempt-list">{attempts.attempts.map((attempt) => {
              const covered = attempt.byDomain?.filter((domain) => domain.answered > 0) || [];
              return <article className="history-attempt" key={attempt.sessionId}>
                <div className="attempt-row"><span className="attempt-date">{formatDate(attempt.completedAt)}</span><span className="attempt-score">{attempt.percent ?? '—'}%</span><span className="attempt-detail">{attempt.correct}/{attempt.totalQuestions} correct</span></div>
                <p className="history-domains">{covered.map((domain) => domain.name || domain.domain).join(' · ') || 'Domain details unavailable'}</p>
                <div className="history-attempt-meta"><span>{attempt.readinessScore === null || attempt.readinessScore === undefined ? 'Readiness unavailable' : `${attempt.readinessScore}% readiness · ${attempt.readinessLevel || 'practice estimate'}`}</span><span>{attempt.luckyGuesses || 0} lucky guesses</span></div>
                <div className="history-actions">
                  <button className="text-button" disabled={busy || historyBusyId === attempt.sessionId} onClick={() => onOpenAttempt(attempt)}>{historyBusyId === attempt.sessionId ? 'Loading…' : 'View results'}</button>
                  <button className="text-button" disabled={busy || historyBusyId === attempt.sessionId} onClick={() => onOpenAttempt(attempt, 'wrong')}>Review mistakes</button>
                  <button className="text-button" disabled={busy || historyBusyId === attempt.sessionId} onClick={() => onOpenAttempt(attempt, 'practice')}>Practise missed</button>
                      <button className="text-button" disabled={busy || historyBusyId === attempt.sessionId} onClick={() => onOpenAttempt(attempt, 'export')}>Export JSON</button>
                    </div>
              </article>;
            })}</div>
            : <p className="history-empty">Your completed quizzes will appear here. Start a practice session to begin your learning history.</p>}
          {attempts?.stats?.bestPercent !== null && attempts?.stats?.bestPercent !== undefined && <div className="best-score">Best practice score <strong>{attempts.stats.bestPercent}%</strong></div>}
          {attempts?.stats?.attemptCount >= 2 && <div className={`readiness-change ${attempts.stats.readinessChange > 0 ? 'change-up' : attempts.stats.readinessChange < 0 ? 'change-down' : ''}`}>{describeReadinessChange(attempts.stats.readinessChange) || 'Readiness comparison unavailable'}</div>}
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

function QuizPage({ quiz, busy, onSelect, onConfidence, onSubmit, onNavigate, onResults, onExit, focusMode, onToggleFocus }) {
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
      {['beginner', 'intermediate', 'advanced'].includes(String(question.difficulty || '').toLowerCase())
        && <span className={`difficulty-badge difficulty-${String(question.difficulty).toLowerCase()}`}>{question.difficulty}</span>}
      <div className="progress-track" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax={quiz.progress.total} aria-valuenow={quiz.progress.answered}><span style={{ width: `${progress}%` }} /></div>
      <div className="quiz-body">
        <article className="question-card" key={question.id}>
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
          {answer && <Feedback feedback={answer.feedback} question={question} />}
          <div className="quiz-controls">
            <button className="button button-secondary" onClick={() => onNavigate(quiz.index - 1)} disabled={quiz.index === 0}>← Previous</button>
            {!answer
              ? <button className="button button-primary" onClick={onSubmit} disabled={!draft.choiceId || busy}>{busy ? <><span className="spinner" /> Submitting…</> : <>Submit answer <span aria-hidden="true">→</span></>}</button>
              : quiz.progress.finished
                ? <button className="button button-primary" onClick={onResults} disabled={busy}>{busy ? 'Loading results…' : <>See your results <span aria-hidden="true">→</span></>}</button>
                : <button className="button button-primary" onClick={() => onNavigate(quiz.index + 1)} disabled={!nextReady}>Next question <span aria-hidden="true">→</span></button>}
          </div>
        </article>
        {!focusMode && <aside className="quiz-aside"><div className="aside-note"><span className="aside-star">✳</span><span className="eyebrow">A NOTE TO YOU</span><h3>There’s no rush.</h3><p>Read each question carefully. Learning is the point — your confidence rating helps make your review more useful.</p></div><div className="question-map"><h3>Your progress</h3><div className="question-dots">{Array.from({ length: quiz.progress.total }, (_, index) => <span key={index} className={`${index === quiz.index ? 'dot-current' : ''} ${index < quiz.progress.answered ? 'dot-answered' : ''}`} aria-label={`Question ${index + 1}${index < quiz.progress.answered ? ', answered' : ''}`} />)}</div><p>{quiz.progress.answered} of {quiz.progress.total} answered</p><button className="text-button finish-link" onClick={onExit}>Save and leave quiz</button></div><p className="aside-disclaimer">Unofficial AZ-900 practice. Not affiliated with Microsoft.</p></aside>}
      </div>
      <p className="keyboard-tip">Tip: use ← and → arrow keys to revisit answered questions. <button className="text-button focus-inline" onClick={onToggleFocus}>{focusMode ? 'Exit Focus Mode' : 'Turn on Focus Mode'}</button></p>
    </section>
  );
}

function Feedback({ feedback, question }) {
  const explanations = feedback.whyOthersAreWrong && question?.choices
    ? question.choices.filter((choice) => choice.id !== feedback.correctChoiceId)
    : [];
  const learnMoreUrl = safeExternalUrl(feedback.learnMoreUrl);
  return <section className={`feedback-card ${feedback.correct ? 'feedback-good' : 'feedback-review'}`} aria-live="polite">
    <div className="feedback-heading"><span className="feedback-symbol">{feedback.correct ? '✓' : '↺'}</span><div><strong>{feedback.correct ? feedback.luckyGuess ? 'Correct — let’s review it again' : 'That’s right!' : 'Not quite — this is a chance to learn'}</strong>{feedback.note && <p>{feedback.note}</p>}{!feedback.correct && feedback.whyYourChoiceIsWrong && <p>{feedback.whyYourChoiceIsWrong}</p>}</div></div>
    <div className="explanation"><span className="eyebrow">THE EXPLANATION</span><p>{feedback.explanation || 'No explanation was provided for this question.'}</p></div>
    {feedback.whyOthersAreWrong && <details className="why-options">
      <summary>Why Not the Other Options?</summary>
      <div className="why-options-list">
        {explanations.length ? explanations.map((choice) => <div className="why-option" key={choice.id}><strong>{choice.text}</strong><p>{feedback.whyOthersAreWrong[choice.id] || 'An explanation was not provided for this option.'}</p></div>)
          : <p className="history-empty">No other-option explanations were included for this question.</p>}
      </div>
    </details>}
    {learnMoreUrl && <a className="learn-more" href={learnMoreUrl} target="_blank" rel="noreferrer">Explore this topic on Microsoft Learn <span aria-hidden="true">↗</span></a>}
  </section>;
}

function ResultsPage({ results, allResults, filter, busy, onFilter, onExport, onHome, onRestart, onPractice, topics, answerFeedback }) {
  const readiness = results.readiness;
  const readinessLabel = { ready: 'Looking ready', almost: 'Almost there', 'not-yet': 'Keep practising', 'not-enough-data': 'More practice needed' }[readiness?.level] || 'Practice summary';
  const allReview = allResults?.review || results.review || [];
  const visibleReview = filterReview(allReview, filter);
  const recommendations = allResults?.recommendations || results.recommendations;
  const practiceSet = recommendations?.practiceSet;
  const misconceptions = allResults?.misconceptions || results.misconceptions || [];
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

      <section className="domain-results"><div className="section-heading compact-heading"><div><span className="eyebrow">WHERE YOU PRACTISED</span><h2>Domain breakdown</h2><p className="section-hint">Score is correctness. Mastery counts answers you got right with confidence.</p></div></div>
        <div className="domain-result-list">{results.byDomain.filter((domain) => domain.answered > 0).map((domain, index) => <div className="domain-result" key={domain.domain}><div className={`domain-result-mark ${DOMAIN_COLORS[index % DOMAIN_COLORS.length]}`}>{['◌', '⌘', '✳'][index % 3]}</div><div className="domain-result-copy"><strong>{domain.name}</strong><div className="result-progress" role="img" aria-label={`Score ${domain.percent ?? 'unavailable'} percent`}><span style={{ width: `${domain.percent ?? 0}%` }} /></div><div className="domain-result-stats"><span>Score: {domain.percent === null || domain.percent === undefined ? '—' : `${domain.percent}%`}</span><span>Mastered: {domain.masteryPercent === null || domain.masteryPercent === undefined ? '—' : `${domain.masteryPercent}%`}</span></div></div><span className="domain-result-count">{domain.correct}/{domain.answered}</span></div>)}
          {!results.byDomain.some((domain) => domain.answered > 0) && <p className="history-empty">No domain answers are available yet.</p>}
        </div>
        {readiness?.notCovered?.length > 0 && <p className="not-covered"><strong>Not covered in this quiz:</strong> {readiness.notCovered.join(' · ')}</p>}
      </section>

      <section className="recommendations-section"><div className="recommendations-heading"><div><span className="eyebrow">YOUR NEXT STEPS</span><h2>Study recommendations</h2></div><span className="recommendations-mark">✳</span></div>
        <p className="recommendations-headline">{recommendations?.headline || 'No recommendations were provided for this attempt.'}</p>
        {recommendations?.items?.length > 0 && <div className="recommendation-list">{recommendations.items.map((item, index) => {
          const url = safeExternalUrl(item.learnMoreUrl);
          return <article className="recommendation-card" key={`${item.type || 'recommendation'}-${index}`}><span className="recommendation-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{item.title}</h3><p>{item.message}</p>{url && <a className="learn-more" href={url} target="_blank" rel="noreferrer">Learn more <span aria-hidden="true">↗</span></a>}</div></article>;
        })}</div>}
        <div className="practice-cta"><div><strong>Ready to keep going?</strong><p>{practiceSet ? 'Start a quiz focused on the topics you should revisit.' : 'This attempt has no focused practice set. Try another mixed quiz to confirm your progress.'}</p></div><button className="button button-primary" onClick={() => practiceSet ? onPractice(practiceSet) : onRestart()} disabled={busy}>{busy ? <><span className="spinner" /> Starting…</> : practiceSet ? 'Practice My Weak Spots →' : 'Start another quiz →'}</button></div>
      </section>

      <section className="misconceptions-section"><div className="recommendations-heading"><div><span className="eyebrow">PATTERNS TO NOTICE</span><h2>Misconceptions to review</h2></div></div>
        {misconceptions.length ? <ul className="misconception-list">{misconceptions.map((item) => <li key={item.tag}><span>{item.label}</span><strong>{item.count} {item.count === 1 ? 'time' : 'times'}</strong></li>)}</ul>
          : <p className="empty-misconceptions">No recurring misconceptions were recorded in this quiz.</p>}
      </section>

      <section className="review-section"><div className="review-heading"><div><span className="eyebrow">LEARN FROM EVERY ANSWER</span><h2>Review your practice</h2><p>Revisit the original explanations and reinforce what you’ve learned.</p></div><button className="button button-secondary" onClick={onExport}>↓ Export JSON</button></div>
        <div className="review-tabs" role="tablist" aria-label="Filter answer review">{[['all', 'All answers'], ['wrong', 'Incorrect'], ['lucky', 'Lucky guesses']].map(([value, label]) => <button key={value} className={filter === value ? 'tab-active' : ''} role="tab" aria-selected={filter === value} onClick={() => onFilter(value)}>{label}</button>)}</div>
        {busy && <p className="loading-line">Loading review…</p>}
        {!busy && visibleReview.length === 0 && <div className="empty-review"><span>✳</span><h3>{filter === 'wrong' ? 'No incorrect answers — lovely work!' : filter === 'lucky' ? 'No lucky guesses to revisit.' : 'No answers to review yet.'}</h3><p>Keep practising to build a useful learning history.</p></div>}
        <div className="review-list">{visibleReview.map((item, index) => <ReviewItem key={item.questionId} item={item} index={index} domainName={getDomainName(item.domain, allResults?.byDomain || results.byDomain, topics)} feedback={answerFeedback[item.questionId]?.feedback} />)}</div>
      </section>
      <div className="results-actions"><button className="button button-secondary" onClick={onHome}>← Back to dashboard</button><button className="button button-primary" disabled={busy} onClick={onRestart}>Start another quiz <span aria-hidden="true">→</span></button></div>
    </section>
  );
}

function ReviewItem({ item, index, domainName, feedback }) {
  const yourChoice = item.choices.find((choice) => choice.id === item.yourChoiceId);
  const correctChoice = item.choices.find((choice) => choice.id === item.correctChoiceId);
  const learnMoreUrl = safeExternalUrl(item.learnMoreUrl);
  return <article className="review-item"><div className="review-item-heading"><span className={`review-number ${item.correct ? 'review-correct' : 'review-incorrect'}`}>{item.correct ? '✓' : '!'}</span><div><span className="eyebrow">{item.topic} · {domainName}</span><h3>{index + 1}. {item.question}</h3></div></div>
    <div className="review-answer-grid"><p><span>Your answer</span><strong>{yourChoice?.text || 'Not recorded'}</strong></p><p><span>Correct answer</span><strong>{correctChoice?.text || 'Not available'}</strong></p></div>
    {item.whyYourChoiceIsWrong && <p className="review-why">{item.whyYourChoiceIsWrong}</p>}
    {item.explanation && <p className="review-explanation">{item.explanation}</p>}
    {feedback?.whyOthersAreWrong && <details className="why-options review-why-options"><summary>Why Not the Other Options?</summary><div className="why-options-list">{item.choices.filter((choice) => choice.id !== item.correctChoiceId).map((choice) => <div className="why-option" key={choice.id}><strong>{choice.text}</strong><p>{feedback.whyOthersAreWrong[choice.id] || 'An explanation was not provided for this option.'}</p></div>)}</div></details>}
    {item.luckyGuess && <span className="lucky-label">Lucky guess · revisit this topic</span>}
    {learnMoreUrl && <a className="learn-more" href={learnMoreUrl} target="_blank" rel="noreferrer">Learn more <span aria-hidden="true">↗</span></a>}
  </article>;
}

function Footer() {
  return <footer className="site-footer"><div className="footer-brand"><span className="brand-mark" aria-hidden="true"><span>✓</span></span><strong>CloudReady</strong></div><p>{DISCLAIMER}</p><span className="footer-tag">MADE FOR LEARNING, NOT FOR THE EXAM ROOM</span></footer>;
}

function formatDate(value) {
  if (!value) return 'Practice session';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Practice session' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function downloadResults(results, quiz) {
  const exportData = buildResultsExport(results, quiz);
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `az900-quiz-results-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function persistCompletedResults(quiz, results, filter = 'all') {
  sessionStorage.setItem(COMPLETED_RESULTS_KEY, JSON.stringify({ quiz, results, filter }));
}

export default App;
