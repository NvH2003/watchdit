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
import { posterUrl, stillUrl, formatAirsLabel, formatRuntime } from '@/lib/tmdb';
import { theme } from '@/constants/theme';
import EpisodeCheck from '@/components/EpisodeCheck';

export type ShowStatus = 'watching' | 'watchLater' | 'finished' | 'upToDate';

interface ShowRowTVProps {
  id: string;
  name: string;
  posterPath: string | null | undefined;
  status: ShowStatus;
  nextSeasonNum?: number | null;
  nextEpisodeNum?: number | null;
  nextEpisodeName?: string | null;
  nextEpisodeAirDate?: string | null;
  nextEpisodeStillPath?: string | null;
  nextEpisodeRuntime?: number | null;
  /** Fallback when next episode runtime isn't stored yet (show average). */
  episodeRuntime?: number | null;
  remainingCount?: number;
  canMark?: boolean;
  onShowPress: () => void;
  onCheckPress: () => void;
  onStatusChange: (id: string, status: ShowStatus) => void;
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

function OverflowMenu({
  visible,
  onClose,
  onWatchLater,
  onRemove,
}: {
  visible: boolean;
  onClose: () => void;
  onWatchLater: () => void;
  onRemove: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.menuOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.menuSafe} pointerEvents="box-none">
          <View style={styles.menuBox}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { onWatchLater(); onClose(); }}
            >
              <Text style={styles.menuItemText}>⏱  Watch Later</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { onRemove(); onClose(); }}
            >
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>✕  Remove</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function ShowRowTV({
  id,
  name,
  posterPath,
  status,
  nextSeasonNum,
  nextEpisodeNum,
  nextEpisodeName,
  nextEpisodeAirDate,
  nextEpisodeStillPath,
  nextEpisodeRuntime,
  episodeRuntime,
  remainingCount,
  canMark = true,
  onShowPress,
  onCheckPress,
  onStatusChange,
  onRemove,
}: ShowRowTVProps) {
  const swipeRef = useRef<Swipeable>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const poster = posterUrl(posterPath, 'w185');
  const still = stillUrl(nextEpisodeStillPath, 'w185');
  const thumb = still ?? poster;

  const season = nextSeasonNum ?? 1;
  const episode = nextEpisodeNum ?? 1;
  const epCode = `S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')}`;
  const remaining = remainingCount ?? 0;
  const airsLabel = formatAirsLabel(nextEpisodeAirDate);
  const runtimeLabel = formatRuntime(nextEpisodeRuntime) ?? formatRuntime(episodeRuntime);

  useEffect(() => {
    setMarking(false);
  }, [nextSeasonNum, nextEpisodeNum]);

  useEffect(() => {
    if (!marking) return;
    const t = setTimeout(() => setMarking(false), 5000);
    return () => clearTimeout(t);
  }, [marking]);

  function handleWatchLater() {
    swipeRef.current?.close();
    onStatusChange(id, 'watchLater');
  }
  function handleRemove() {
    swipeRef.current?.close();
    onRemove(id);
  }

  const rowContent = (
    <View style={styles.row}>
      {/* Poster */}
      <TouchableOpacity onPress={onShowPress} activeOpacity={0.8}>
        <View style={still ? styles.stillWrap : styles.posterWrap}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={still ? styles.still : styles.poster} />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={styles.posterEmoji}>📺</Text>
            </View>
          )}
          {marking ? (
            <View style={styles.stillFlash} pointerEvents="none">
              <Text style={styles.stillFlashMark}>✓</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>

      {/* Info */}
      <View style={styles.info}>
        <TouchableOpacity onPress={onShowPress} activeOpacity={0.7} style={styles.showTitleBtn}>
          <Text style={styles.showTitle} numberOfLines={2}>
            {name}
          </Text>
        </TouchableOpacity>

        <View style={styles.epRow}>
          <Text style={styles.epCode}>{epCode}</Text>
          {remaining > 0 && (
            <Text style={styles.remaining}> +{remaining}</Text>
          )}
        </View>

        {nextEpisodeName || runtimeLabel ? (
          <Text style={styles.epName} numberOfLines={1}>
            {nextEpisodeName || 'Episode'}
            {runtimeLabel ? ` · ${runtimeLabel}` : ''}
          </Text>
        ) : null}
        {airsLabel ? (
          <Text style={styles.airsLabel}>{airsLabel}</Text>
        ) : null}
      </View>

      {/* Right side actions */}
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
              if (marking) return;
              setMarking(true);
              onCheckPress();
            }}
            activeOpacity={0.75}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={marking ? 'Marked as watched' : 'Mark episode as watched'}
          >
            <EpisodeCheck watched={marking} size={28} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} accessibilityLabel="This episode isn't out yet">
            <Ionicons name="time-outline" size={20} color={theme.faint} />
          </View>
        )}
      </View>
    </View>
  );

  const menu = (
    <OverflowMenu
      visible={menuOpen}
      onClose={() => setMenuOpen(false)}
      onWatchLater={() => onStatusChange(id, 'watchLater')}
      onRemove={() => onRemove(id)}
    />
  );

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
          <RightActions onWatchLater={handleWatchLater} onRemove={handleRemove} />
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
  },
  stillWrap: {
    position: 'relative',
    borderRadius: 6,
    overflow: 'hidden',
  },
  posterWrap: {
    position: 'relative',
    borderRadius: 6,
    overflow: 'hidden',
  },
  still: {
    width: 96,
    height: 54,
    borderRadius: 6,
    backgroundColor: theme.elevated,
  },
  stillFlash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(61, 206, 122, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stillFlashMark: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  posterPlaceholder: {
    backgroundColor: theme.elevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterEmoji: {
    fontSize: 20,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  showTitleBtn: {
    alignSelf: 'stretch',
  },
  showTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19,
  },
  epRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  epCode: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  remaining: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  epName: {
    color: theme.muted,
    fontSize: 13,
  },
  airsLabel: {
    color: theme.gold,
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
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  watchLaterBtn: {
    backgroundColor: theme.gold,
  },
  removeBtn: {
    backgroundColor: theme.accent,
  },
  actionEmoji: {
    color: '#fff',
    fontSize: 16,
  },
  actionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
  },
  menuSafe: {
    width: Platform.OS === 'web' ? undefined : '100%',
    paddingHorizontal: Platform.OS === 'web' ? 0 : 12,
    paddingBottom: Platform.OS === 'web' ? 0 : 8,
  },
  menuBox: {
    backgroundColor: theme.elevated,
    borderRadius: 14,
    overflow: 'hidden',
    width: Platform.OS === 'web' ? 220 : undefined,
    borderWidth: 1,
    borderColor: theme.border,
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  menuItemText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '500',
  },
  menuItemDanger: {
    color: theme.accent,
  },
  menuDivider: {
    height: 1,
    backgroundColor: theme.border,
  },
});
