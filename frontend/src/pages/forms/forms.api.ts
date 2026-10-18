import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type ChoiceOption = {
  id: string;
  label: string;
};

export type FormQuestion = {
  id: string;
  text: string;
  type: string;
  required: boolean;
  helpText: string;
  scale_direction?: 'higher_is_better';
  scale_min?: number;
  scale_max?: number;
  min_label?: string;
  max_label?: string;
  options?: ChoiceOption[] | string[];
  [key: string]: unknown;
};

export type FormBlock =
  | { type: 'section'; section_id: number; questions: FormQuestion[] }
  | { type: 'question'; question: FormQuestion };

export type ReviewForm = {
  id: number;
  name: string;
  description: string;
  questions: FormBlock[];
};

export type ReviewFormValues = {
  name: string;
  description: string;
  questions: FormBlock[];
  source_template_id?: number;
};

type FormResponse = {
  id: number;
  name: string;
  description: string | null;
  questions: unknown;
};

function mapQuestion(question: unknown, index: number): FormQuestion {
  const item = question && typeof question === 'object' ? question : {};
  return {
    ...item,
    id:
      'id' in item && typeof item.id === 'string'
        ? item.id
        : crypto.randomUUID(),
    text:
      'text' in item && typeof item.text === 'string'
        ? item.text
        : `Question ${index + 1}`,
    type:
      'type' in item && typeof item.type === 'string' ? item.type : 'Text',
    required:
      'required' in item && typeof item.required === 'boolean'
        ? item.required
        : false,
    helpText:
      'helpText' in item && typeof item.helpText === 'string'
        ? item.helpText
        : '',
  };
}

function mapBlock(block: unknown, index: number): FormBlock {
  if (block && typeof block === 'object' && 'type' in block && block.type === 'section' && 'section_id' in block && typeof block.section_id === 'number') {
    const nested = 'questions' in block && Array.isArray(block.questions) ? block.questions : [];
    return { type: 'section', section_id: block.section_id, questions: nested.map(mapQuestion) };
  }
  if (block && typeof block === 'object' && 'type' in block && block.type === 'question' && 'question' in block) {
    return { type: 'question', question: mapQuestion(block.question, index) };
  }
  return { type: 'question', question: mapQuestion(block, index) };
}

function mapForm(form: FormResponse): ReviewForm {
  const questions = Array.isArray(form.questions) ? form.questions : [];
  return {
    id: form.id,
    name: form.name,
    description: form.description || '',
    questions: questions.map(mapBlock),
  };
}

async function requestApi<T>(getAccessToken: AccessTokenGetter, path: string, options: RequestInit, fallback: string): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, path, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

export async function fetchForms(getAccessToken: AccessTokenGetter, signal: AbortSignal): Promise<ReviewForm[]> {
  const forms = await requestApi<FormResponse[]>(getAccessToken, '/forms', { signal }, 'Forms could not be loaded.');
  return forms.map(mapForm);
}

export async function fetchFormTemplates(getAccessToken: AccessTokenGetter, signal: AbortSignal): Promise<ReviewForm[]> {
  const templates = await requestApi<FormResponse[]>(
    getAccessToken,
    '/form-templates',
    { signal },
    'Templates could not be loaded.',
  );
  return templates.map(mapForm);
}

export async function createFormTemplate(getAccessToken: AccessTokenGetter, form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
      getAccessToken,
      '/form-templates',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      },
      'Template could not be saved.',
    ),
  );
}

export async function updateFormTemplate(getAccessToken: AccessTokenGetter, id: number, form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
      getAccessToken,
      `/form-templates/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      },
      'Template could not be updated.',
    ),
  );
}

export async function deleteFormTemplate(getAccessToken: AccessTokenGetter, id: number): Promise<void> {
  await requestApi(getAccessToken, `/form-templates/${id}`, { method: 'DELETE' }, 'Template could not be deleted.');
}

export async function createForm(getAccessToken: AccessTokenGetter, form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
      getAccessToken,
      '/forms',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      },
      'Form could not be saved.',
    ),
  );
}

export async function createFormFromTemplate(
  getAccessToken: AccessTokenGetter,
  name: string,
  description: string,
  templateId: number,
): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
      getAccessToken,
      '/forms',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          source_template_id: templateId,
        }),
      },
      'Form could not be created from template.',
    ),
  );
}

export async function updateForm(getAccessToken: AccessTokenGetter, id: number, form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
      getAccessToken,
      `/forms/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      },
      'Form could not be updated.',
    ),
  );
}

export async function deleteForm(getAccessToken: AccessTokenGetter, id: number): Promise<void> {
  await requestApi(getAccessToken, `/forms/${id}`, { method: 'DELETE' }, 'Form could not be deleted.');
}
