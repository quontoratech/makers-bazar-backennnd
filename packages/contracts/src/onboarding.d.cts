export type Answer = string | number | boolean | string[] | Record<string, string | number | boolean>[];
export type Answers = Record<string, Answer>;
export interface Field {
    key: string;
    label: string;
    step: number;
    type:
        | 'text'
        | 'textarea'
        | 'email'
        | 'tel'
        | 'url'
        | 'number'
        | 'date'
        | 'time'
        | 'select'
        | 'multi'
        | 'checkbox'
        | 'file'
        | 'repeater';
    required?: boolean;
    options?: string[];
    legacyOptions?: string[];
    categories?: string[];
    section?: string;
    listing?: string;
    when?: [string, string | boolean];
    unless?: [string, string | boolean | (string | boolean)[]];
    unlessListing?: string;
    children?: Field[];
    min?: number;
    max?: number;
    accept?: string;
    multiple?: boolean;
}
export const steps: string[];
export const categories: { id: string; label: string; vendorLabel: string; listingType: string }[];
export const fields: Field[];
export function visibleFields(answers: Answers, step?: number): Field[];
export function syncSupportPhone(answers: Answers, previous?: Answers): Answers;
export function sanitizeAnswers(input: unknown): Answers;
export function validate(answers: Answers, step?: number): Record<string, string>;
export function completeness(answers: Answers): { complete: number; total: number; percent: number };
export function categoryAccessFields(answers: Answers): Field[];
export function sanitizeCategoryAccessAnswers(input: unknown, categoryIds: string[]): Answers;
export function validateCategoryAccessAnswers(answers: Answers): Record<string, string>;
