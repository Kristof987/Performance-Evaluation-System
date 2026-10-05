import AppLayout from '../layout/AppLayout';
import './employee-results.css';

const resultRows = [
  { area: 'Goal achievement', score: '4.4 / 5', note: 'Strong delivery on quarterly priorities.' },
  { area: 'Collaboration', score: '4.7 / 5', note: 'Peers highlighted reliability and support.' },
  { area: 'Ownership', score: '4.2 / 5', note: 'Good follow-through, with room to delegate earlier.' },
];

export default function EmployeeResults() {
  return (
    <AppLayout activePage="results" pageClassName="employee-results-page">
      <div className="main-content employee-results-main">
        <section className="employee-results-hero card">
          <div>
            <p>Results</p>
            <h1>Your performance summary</h1>
            <span>Temporary sample data until real evaluation results are connected.</span>
          </div>
        </section>

        <section className="card employee-results-panel">
          {resultRows.map((result) => (
            <div className="employee-results-row" key={result.area}>
              <div>
                <strong>{result.area}</strong>
                <span>{result.note}</span>
              </div>
              <b>{result.score}</b>
            </div>
          ))}
        </section>
      </div>
    </AppLayout>
  );
}
