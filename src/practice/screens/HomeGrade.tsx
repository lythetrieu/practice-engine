// "When is your test?" with the student's grade. The grade (the pack's `audience` options) is asked once here, saved
// in the progress (store.ts Progress.grade) and used to list only the test days for that grade (pack.yaml testDates
// with `grades`). "Later" is for a test with no date to pick yet. Me and Home both open it. A signed-in child's grade
// (ctx Me.grade) wins over the picked one.
import { useApp } from '../ctx';
import { Sheet } from '../ui';
import { testDaysFor, gradeOf, GRADES } from '../store';
import { config } from '../../pack';

export function TestDaySheet({ onClose }: { onClose: () => void }) {
  const { p, me, update, sfx } = useApp();
  const grade = gradeOf(p, me.grade);
  const locked = typeof me.grade === 'number' && GRADES.includes(me.grade);   // the account knows the grade: no picker
  const days = testDaysFor(grade);
  const setGrade = (g: number) => { sfx('tap'); update((q) => ({ ...q, grade: g })); };
  const aud = config.audience;
  return (
    <Sheet label="Your test day" onClose={onClose}>
      <h2 className="pa-sheet-title">When is your {config.exam}?</h2>
      {locked || !aud ? null : (
        <>
          <p className="pa-sheet-sub">First: {aud.label.toLowerCase()}?</p>
          <div className="pa-grades" role="radiogroup" aria-label={aud.label}>
            {aud.options.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={grade === o.value} className={'pa-grade press' + (grade === o.value ? ' on' : '')} onClick={() => setGrade(o.value)}>
                <span className="d">{o.value}</span><span className="w">{o.label.replace(String(o.value), '').trim() || aud.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {aud && grade === null && !locked ? null : (
        <>
          <p className="pa-sheet-sub">{days.length ? 'Pick your day to see a countdown.' : 'No test days are listed yet.'}</p>
          <div className="pa-testdays" role="radiogroup" aria-label="Test day">
            {days.map((d) => {
              const on = p.testDate === d.day;
              return (
                <button key={d.day} type="button" role="radio" aria-checked={on} className={'pa-testday press' + (on ? ' on' : '')}
                  onClick={() => { sfx('tap'); update((q) => ({ ...q, testDate: d.day, nextFall: false })); onClose(); }}>
                  <span className="d">{d.label}</span>{d.who ? <span className="w">{d.who}</span> : null}
                </button>
              );
            })}
            <button type="button" role="radio" aria-checked={p.nextFall} className={'pa-testday press' + (p.nextFall ? ' on' : '')}
              onClick={() => { sfx('tap'); update((q) => ({ ...q, nextFall: true, testDate: null })); onClose(); }}>
              <span className="d">Later</span><span className="w">My day is not set yet</span>
            </button>
          </div>
        </>
      )}
      {p.testDate || p.nextFall ? (
        <button type="button" className="pa-linkbtn" onClick={() => { update((q) => ({ ...q, testDate: null, nextFall: false })); onClose(); }}>Clear my test day</button>
      ) : null}
    </Sheet>
  );
}
