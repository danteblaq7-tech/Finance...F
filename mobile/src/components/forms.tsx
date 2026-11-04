import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import type { TextInputProps } from 'react-native';
import { TextField } from './ui';

/** react-hook-form binding for TextField: wires value/blur/error automatically. */
export function FormTextField<T extends FieldValues>({
  control, name, label, hint, ...input
}: { control: Control<T>; name: Path<T>; label: string; hint?: string } & Omit<TextInputProps, 'value' | 'onChangeText' | 'onBlur'>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur }, fieldState: { error } }) => (
        <TextField label={label} hint={hint} error={error?.message} value={(value as string | undefined) ?? ''} onChangeText={onChange} onBlur={onBlur} {...input} />
      )}
    />
  );
}
