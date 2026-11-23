import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View, type TextInputProps } from 'react-native';
import { AppText, Button, Field, SelectField, TextField } from './ui';

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

export function FormSelectField<T extends FieldValues>({
  control, name, label, options, placeholder,
}: {
  control: Control<T>; name: Path<T>; label: string; options: { label: string; value: string }[]; placeholder?: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <SelectField label={label} value={String(value ?? '')} options={options} onChange={onChange} error={error?.message} placeholder={placeholder} />
      )}
    />
  );
}

export function FormDateField<T extends FieldValues>({
  control, name, label,
}: { control: Control<T>; name: Path<T>; label: string }) {
  const [show, setShow] = useState(false);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange }, fieldState: { error } }) => {
        const selected = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
          ? new Date(`${value}T12:00:00`)
          : new Date();
        return (
          <View>
            <Field label={label} error={error?.message}>
              <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setShow(true)}>
                <AppText variant="body" style={{ padding: 13, borderWidth: 1, borderRadius: 10 }}>
                  {typeof value === 'string' && value ? value : 'Select date'}
                </AppText>
              </Pressable>
            </Field>
            {show ? (
              <>
                <DateTimePicker
                  value={selected}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => {
                    if (date && event.type === 'set') {
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      onChange(`${year}-${month}-${day}`);
                    }
                    if (Platform.OS !== 'ios' || event.type === 'dismissed') setShow(false);
                  }}
                />
                {Platform.OS === 'ios' ? <Button title="Done" variant="secondary" onPress={() => setShow(false)} /> : null}
              </>
            ) : null}
          </View>
        );
      }}
    />
  );
}
