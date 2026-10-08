import { API_BASE_URL } from '../../config';

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
  options?: ChoiceOption[] | string[];
  [key: string]: unknown;
};

export type ReviewForm = {
  id: number;
  name: string;
  description: string;
  questions: FormQuestion[];
};

export type ReviewFormValues = {
  name: string;
  description: string;
  questions: FormQuestion[];
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

function mapForm(form: FormResponse): ReviewForm {
  const questions = Array.isArray(form.questions) ? form.questions : [];
  return {
    id: form.id,
    name: form.name,
    description: form.description || '',
    questions: questions.map(mapQuestion),
  };
}

async function requestApi<T>(path: string, options: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

export async function fetchForms(signal: AbortSignal): Promise<ReviewForm[]> {
  const forms = await requestApi<FormResponse[]>('/forms', { signal }, 'Forms could not be loaded.');
  return forms.map(mapForm);
}

export async function fetchFormTemplates(signal: AbortSignal): Promise<ReviewForm[]> {
  const templates = await requestApi<FormResponse[]>(
    '/form-templates',
    { signal },
    'Templates could not be loaded.',
  );
  return templates.map(mapForm);
}

export async function createFormTemplate(form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
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

export async function updateFormTemplate(id: number, form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
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

export async function deleteFormTemplate(id: number): Promise<void> {
  await requestApi(`/form-templates/${id}`, { method: 'DELETE' }, 'Template could not be deleted.');
}

export async function createForm(form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
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
  name: string,
  description: string,
  templateId: number,
): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
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

export async function updateForm(id: number, form: ReviewFormValues): Promise<ReviewForm> {
  return mapForm(
    await requestApi<FormResponse>(
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

export async function deleteForm(id: number): Promise<void> {
  await requestApi(`/forms/${id}`, { method: 'DELETE' }, 'Form could not be deleted.');
}
