import { Controller } from 'react-hook-form';

import { TextField } from './ui';

/** react-hook-form binding for TextField: wires value/blur/error automatically. */
export function FormTextField({ control, name, label, hint, ...input }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
        <TextField
          label={label}
          hint={hint}
          error={error?.message}
          value={value ?? ''}
          onChangeText={onChange}
          onBlur={onBlur}
          {...input}
        />
      )}
    />
  );
}
