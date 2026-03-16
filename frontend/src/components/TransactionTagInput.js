import React from 'react';
import CreatableSelect from 'react-select/creatable';

const darkStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: 32,
    background: 'rgba(15, 23, 42, 0.9)',
    borderColor: state.isFocused ? '#f97316' : 'rgba(255,255,255,0.2)',
    boxShadow: state.isFocused ? '0 0 0 2px rgba(249,115,22,0.25)' : 'none',
    '&:hover': { borderColor: state.isFocused ? '#f97316' : 'rgba(255,255,255,0.35)' },
    fontSize: '0.85rem',
    cursor: 'text',
  }),
  menu: (base) => ({
    ...base,
    background: 'rgba(15, 23, 42, 0.98)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    zIndex: 50,
  }),
  menuList: (base) => ({
    ...base,
    padding: 4,
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.85rem',
    padding: '6px 10px',
    borderRadius: 4,
    background: state.isFocused ? 'rgba(251,191,36,0.15)' : 'transparent',
    color: state.isFocused ? '#fbbf24' : '#e2e8f0',
    cursor: 'pointer',
    '&:active': { background: 'rgba(251,191,36,0.25)' },
  }),
  multiValue: (base) => ({
    ...base,
    background: 'rgba(251,191,36,0.18)',
    borderRadius: 4,
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: '#fbbf24',
    fontSize: '0.8rem',
    padding: '1px 4px',
  }),
  multiValueRemove: (base) => ({
    ...base,
    color: '#fbbf24',
    '&:hover': { background: 'rgba(251,191,36,0.35)', color: '#fff' },
  }),
  input: (base) => ({
    ...base,
    color: '#e2e8f0',
    fontSize: '0.85rem',
  }),
  placeholder: (base) => ({
    ...base,
    color: '#64748b',
    fontSize: '0.85rem',
  }),
  noOptionsMessage: (base) => ({
    ...base,
    color: '#64748b',
    fontSize: '0.85rem',
  }),
  clearIndicator: (base) => ({
    ...base,
    color: '#64748b',
    padding: 2,
    '&:hover': { color: '#e2e8f0' },
  }),
  dropdownIndicator: () => ({ display: 'none' }),
  indicatorSeparator: () => ({ display: 'none' }),
};

export default function TransactionTagInput({ value = [], options = [], onChange, onCreateOption, autoFocus = false }) {
  const selectValue = value.map((t) => ({ value: t, label: t }));
  const selectOptions = options.map((t) => ({ value: t, label: t }));

  const handleChange = (newValue) => {
    onChange((newValue || []).map((opt) => opt.value));
  };

  const handleCreate = (inputValue) => {
    const tag = inputValue.trim().replace(/^#+/, '').toLowerCase();
    if (!tag) return;
    const next = [...value, tag];
    onChange(next);
    if (onCreateOption) onCreateOption(tag);
  };

  return (
    <CreatableSelect
      isMulti
      value={selectValue}
      options={selectOptions}
      onChange={handleChange}
      onCreateOption={handleCreate}
      styles={darkStyles}
      placeholder="Add tags…"
      formatCreateLabel={(input) => `Create "${input}"`}
      menuPortalTarget={document.body}
      autoFocus={autoFocus}
    />
  );
}
