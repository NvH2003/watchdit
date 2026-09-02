import { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { posterUrl, formatAirsLabel, formatRuntime } from '@/lib/tmdb';
import { theme } from '@/constants/theme';
import EpisodeCheck from '@/components/EpisodeCheck';

export type MovieStatus = 'watching' | 'watchLater' | 'finished';

interface MovieRowProps {
  id: string;
  name: string;
  posterPath: string | null | undefined;
  releaseDate?: string | null;
  runtime?: number | null;
  checked?: boolean;
  canMark?: boolean;
  onPress: () => void;
  onCheckPress: () => void;
  onWatchLater: (id: string) => void;
  onRemove: (id: string) => void;
}

function RightActions({
  onWatchLater,
  onRemove,
}: {
  onWatchLater: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.rightActions}>
      <TouchableOpacity style={[styles.actionBtn, styles.watchLaterBtn]} onPress={onWatchLater}>
        <Text style={styles.actionEmoji}>⏱</Text>
        <Text style={styles.actionText}>Later</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.actionBtn, styles.removeBtn]} onPress={onRemove}>
        <Text style={styles.actionEmoji}>✕</Text>
        <Text style={styles.actionText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MovieRow({
  id,
  name,
  posterPath,
  releaseDate,
  runtime,
  checked = false,
  canMark = true,
  onPress,
  onCheckPress,
  onWatchLater,
  onRemove,
}: MovieRowProps) {
  const swipeRef = useRef<Swipeable>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const poster = posterUrl(posterPath, 'w185');
  const airsLabel = formatAirsLabel(releaseDate);
  const runtimeLabel = formatRuntime(runtime);

  useEffect(() => {
    if (!marking) return;
    const t = setTimeout(() => setMarking(false), 5000);
    return () => clearTimeout(t);
  }, [marking]);

  const rowContent = (
    <View style={styles.row}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Text style={styles.posterFallbackText}>🎬</Text>
          </View>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.info} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.kindRow}>
          <Text style={styles.kindPill}>Movie</Text>
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[releaseDate ? releaseDate.slice(0, 4) : null, runtimeLabel].filter(Boolean).join(' · ')}
        </Text>
        {airsLabel ? <Text style={styles.airs}>{airsLabel}</Text> : null}
      </TouchableOpacity>
      <View style={styles.rightSide}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={theme.muted} />
        </TouchableOpacity>
        {canMark ? (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => {
              if (checked) {
                onCheckPress();
                return;
              }
              if (marking) return;
              setMarking(true);
              onCheckPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              checked || marking ? 'Marked as watched' : 'Mark movie as watched'
            }
          >
            <EpisodeCheck watched={checked || marking} size={28} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} accessibilityLabel="This movie isn't out yet">
            <Ionicons name="time-outline" size={20} color={theme.faint} />
          </View>
        )}
      </View>
    </View>
  );

  const menu = menuOpen ? (
    <Modal transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
      <View style={styles.menuOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
        <SafeAreaView edges={['bottom']} style={styles.menuSafe} pointerEvents="box-none">
          <View style={styles.menuBox}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onWatchLater(id);
                setMenuOpen(false);
              }}
            >
              <Text style={styles.menuItemText}>⏱  Watch Later</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onRemove(id);
                setMenuOpen(false);
              }}
            >
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>✕  Remove</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  ) : null;

  if (Platform.OS === 'web') {
    return (
      <>
        {rowContent}
        {menu}
      </>
    );
  }

  return (
    <>
      <Swipeable
        ref={swipeRef}
        renderRightActions={() => (
          <RightActions
            onWatchLater={() => {
              swipeRef.current?.close();
              onWatchLater(id);
            }}
            onRemove={() => {
              swipeRef.current?.close();
              onRemove(id);
            }}
          />
        )}
        friction={2}
        rightThreshold={40}
      >
        {rowContent}
      </Swipeable>
      {menu}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  poster: {
    width: 52,
    height: 76,
    borderRadius: 6,
    backgroundColor: theme.elevated,
  },
  posterFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterFallbackText: {
    fontSize: 22,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  kindRow: {
    flexDirection: 'row',
  },
  kindPill: {
    color: theme.gold,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  name: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    color: theme.muted,
    fontSize: 12,
  },
  airs: {
    color: theme.sky,
    fontSize: 12,
    fontWeight: '600',
  },
  rightSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rightActions: {
    flexDirection: 'row',
  },
  actionBtn: {
    width: 76,
    justifyContent: 'center',
    alignItems: 'center',
  },
  watchLaterBtn: {
    backgroundColor: theme.gold,
  },
  removeBtn: {
    backgroundColor: theme.danger,
  },
  actionEmoji: {
    fontSize: 16,
    marginBottom: 4,
  },
  actionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: Platform.OS === 'web' ? 'stretch' : 'stretch',
    padding: Platform.OS === 'web' ? 32 : 0,
  },
  menuSafe: {
    width: '100%',
    paddingHorizontal: Platform.OS === 'web' ? 0 : 12,
    paddingBottom: Platform.OS === 'web' ? 0 : 8,
    maxWidth: Platform.OS === 'web' ? 400 : undefined,
    alignSelf: Platform.OS === 'web' ? 'center' : 'stretch',
  },
  menuBox: {
    backgroundColor: theme.elevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemText: {
    color: theme.text,
    fontSize: 15,
  },
  menuItemDanger: {
    color: theme.accent,
  },
  menuDivider: {
    height: 1,
    backgroundColor: theme.border,
  },
});
