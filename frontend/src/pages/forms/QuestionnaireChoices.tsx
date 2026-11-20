import './questionnaire-choices.css';

export function RatingChoices({ name, min, max, minLabel, maxLabel, labels, value, readOnly = false, onChange }: {
  name: string;
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  /** One label per value, lowest first. When every value is labelled the scale is shown as a list, in the same order as the editor. */
  labels?: string[];
  value?: number;
  readOnly?: boolean;
  onChange?: (rating: number) => void;
}) {
  if (labels && labels.length === max - min + 1 && labels.every((label) => typeof label === 'string' && label.trim())) {
    return <fieldset className="questionnaire-rating-labelled"><legend className="sr-only">{name}</legend>
      {labels.map((label, index) => ({ label, rating: min + index })).map(({ label, rating }) => <label key={rating}>
        <input type="radio" name={name} checked={onChange ? value === rating : undefined} disabled={readOnly} onChange={() => onChange?.(rating)} />
        <b>{rating}</b>
        <span>{label}</span>
      </label>)}
    </fieldset>;
  }
  return <div className="questionnaire-rating-scroll"><div className="questionnaire-rating">
    <fieldset className="questionnaire-rating-options"><legend className="sr-only">{name}</legend>
      {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((rating) => <label key={rating}>
        <input type="radio" name={name} checked={onChange ? value === rating : undefined} disabled={readOnly} onChange={() => onChange?.(rating)} />
        <span>{rating}</span>
      </label>)}
    </fieldset>
    <div className="questionnaire-rating-endpoints"><span>{minLabel || 'Lowest rating'}</span><span>{maxLabel || 'Highest rating'}</span></div>
  </div></div>;
}

export function ChoiceRows({ name, options, multiple, value, readOnly = false, onChange }: {
  name: string;
  options: { value: string; label: string }[];
  multiple: boolean;
  value?: string | string[];
  readOnly?: boolean;
  onChange?: (value: string | string[]) => void;
}) {
  return <fieldset className="questionnaire-choice-rows"><legend className="sr-only">{name}</legend>
    {options.map((option) => <label key={option.value}>
      <input type={multiple ? 'checkbox' : 'radio'} name={name} checked={onChange ? multiple ? Array.isArray(value) && value.includes(option.value) : value === option.value : undefined} disabled={readOnly}
        onChange={(event) => onChange?.(multiple ? event.target.checked ? [...(Array.isArray(value) ? value : []), option.value] : (Array.isArray(value) ? value : []).filter((item) => item !== option.value) : option.value)} />
      <span>{option.label}</span>
    </label>)}
  </fieldset>;
}
