'use client'

import type {Question} from '@/lib/scheduler/types'
import {FiX} from 'react-icons/fi'
import styles from './QuestionsEditor.module.css'

export default function QuestionsEditor({value, onChange}: {value: Question[]; onChange: (questions: Question[]) => void}) {
  function update(index: number, patch: Partial<Question>) {
    onChange(value.map((question, i) => i === index ? {...question, ...patch} : question))
  }

  return <div className={styles.list}>
    {value.map((question, index) => <div className={styles.question} key={index}>
      <div className={styles.row}>
        <label><span>Label</span><input value={question.label} onChange={(event) => update(index, {label: event.target.value})} required /></label>
        <label><span>Key</span><input value={question.key} onChange={(event) => update(index, {key: event.target.value})} pattern="[a-z][a-z0-9_]*" required /></label>
        <label><span>Type</span><select value={question.type} onChange={(event) => update(index, {type: event.target.value as Question['type']})}>
          <option value="text">Short text</option><option value="textarea">Long text</option><option value="select">Select</option>
        </select></label>
      </div>
      <div className={styles.row}>
        <label><span>Placeholder</span><input value={question.placeholder ?? ''} onChange={(event) => update(index, {placeholder: event.target.value})} /></label>
        <label><span>Lead field</span><select value={question.leadField ?? ''} onChange={(event) => update(index, {leadField: event.target.value === 'role' ? 'role' : undefined})}>
          <option value="">None</option><option value="role">Role</option>
        </select></label>
      </div>
      {question.type === 'select' && <div className={styles.options}>
        <span>Options</span>
        {(question.options ?? []).map((option, optionIndex) => <div className={styles.option} key={optionIndex}>
          <input aria-label={`Option ${optionIndex + 1}`} value={option} onChange={(event) => update(index, {options: (question.options ?? []).map((item, i) => i === optionIndex ? event.target.value : item)})} />
          <button type="button" title="Remove option" aria-label={`Remove option ${optionIndex + 1}`} onClick={() => update(index, {options: (question.options ?? []).filter((_, i) => i !== optionIndex)})}><FiX aria-hidden="true" /></button>
        </div>)}
        <button className={styles.add} type="button" onClick={() => update(index, {options: [...(question.options ?? []), '']})}>Add option</button>
      </div>}
      <div className={styles.actions}>
        <label><input type="checkbox" checked={Boolean(question.required)} onChange={(event) => update(index, {required: event.target.checked})} /> Required</label>
        <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove question</button>
      </div>
    </div>)}
    <button className={styles.add} type="button" onClick={() => onChange([...value, {key: '', label: '', type: 'text', required: false}])}>Add question</button>
  </div>
}
