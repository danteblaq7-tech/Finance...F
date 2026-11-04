import { type ReactElement, type ReactNode } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { SPACING } from '@/theme/theme';
import { Empty, ErrorNote, Spinner } from './ui';

/** A virtualised list page with pull-to-refresh, loading, error and empty states. */
export function ListScreen<T>({
  header, data, renderItem, keyExtractor, loading, error, emptyText, refreshing, onRefresh, edges = ['top'],
}: {
  header: ReactNode;
  data: T[] | undefined;
  renderItem: (item: T) => ReactElement;
  keyExtractor: (item: T) => string;
  loading: boolean;
  error: unknown;
  emptyText: string;
  refreshing: boolean;
  onRefresh: () => void;
  edges?: ('top' | 'bottom')[];
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: colors.bg_primary }}>
      <FlatList
        data={data ?? []}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => renderItem(item)}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.sm + 4 }} />}
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent_teal_lt} />}
        ListHeaderComponent={
          <View>
            {header}
            {error ? <ErrorNote error={error} /> : null}
            {loading ? <Spinner /> : null}
          </View>
        }
        ListEmptyComponent={!loading && !error ? <Empty>{emptyText}</Empty> : undefined}
      />
    </SafeAreaView>
  );
}
