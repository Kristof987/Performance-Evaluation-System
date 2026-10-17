import './questionnaire-choices.css';

export function RatingChoices({ name, min, max, minLabel, maxLabel, value, readOnly = false, onChange }: {
  name: string;
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
  value?: number;
  readOnly?: boolean;
  onChange?: (rating: number) => void;
}) {
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
