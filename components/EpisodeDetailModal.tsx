import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { stillUrl, formatPrettyDate, formatRuntime } from '@/lib/tmdb';
import { theme } from '@/constants/theme';

export type EpisodeDetailModalProps = {
  visible: boolean;
  onClose: () => void;
  onShowPress?: () => void;
  showName?: string;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  name?: string | null;
  airDate?: string | null;
  runtime?: number | null;
  voteAverage?: number | null;
  stillPath?: string | null;
  overview?: string | null;
  loading?: boolean;
};

export default function EpisodeDetailModal({
  visible,
  onClose,
  onShowPress,
  showName,
  seasonNumber,
  episodeNumber,
  name,
  airDate,
  runtime,
  voteAverage,
  stillPath,
  overview,
  loading = false,
}: EpisodeDetailModalProps) {
  const still = stillUrl(stillPath, 'w300');
  const epCode =
    seasonNumber != null && episodeNumber != null
      ? `S${seasonNumber} E${episodeNumber}`
      : episodeNumber != null
        ? `E${episodeNumber}`
        : '';
  const heading = [epCode, name].filter(Boolean).join(' · ');
  const rating =
    voteAverage != null && voteAverage > 0 ? `★ ${voteAverage.toFixed(1)}` : null;
  const meta = [formatPrettyDate(airDate), formatRuntime(runtime), rating]
    .filter(Boolean)
    .join(' · ');
  const body = overview?.trim() ?? '';

  function goToShow() {
    onClose();
    onShowPress?.();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.box}>
          <View style={styles.hero}>
            {still ? (
              <Image source={{ uri: still }} style={styles.still} resizeMode="cover" />
            ) : (
              <View style={[styles.still, styles.stillPlaceholder]} />
            )}
            <View style={styles.heroFade} pointerEvents="none" />
            <TouchableOpacity
              style={styles.closeHit}
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            {showName && onShowPress ? (
              <TouchableOpacity
                style={styles.showPill}
                onPress={goToShow}
                activeOpacity={0.8}
              >
                <Text style={styles.showPillText} numberOfLines={1}>
                  {showName.toUpperCase()}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#fff" />
              </TouchableOpacity>
            ) : showName ? (
              <Text style={styles.showName}>{showName.toUpperCase()}</Text>
            ) : null}

            {heading ? <Text style={styles.title}>{heading}</Text> : null}
            {meta ? <Text style={styles.meta}>{meta}</Text> : null}

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
            >
              {loading && !body ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Text style={styles.overview}>
                  {body || 'No description available.'}
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  box: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '88%',
    backgroundColor: theme.bg,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
    zIndex: 1,
  },
  hero: {
    position: 'relative',
    width: '100%',
    height: 220,
    backgroundColor: theme.elevated,
  },
  still: {
    width: '100%',
    height: '100%',
  },
  stillPlaceholder: {
    backgroundColor: theme.elevated,
  },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 48,
    backgroundColor: 'rgba(18, 17, 16, 0.45)',
  },
  closeHit: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 10,
  },
  showPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(243, 239, 232, 0.85)',
    maxWidth: '100%',
  },
  showPillText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  showName: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
  },
  meta: {
    color: theme.muted,
    fontSize: 13,
  },
  scroll: {
    maxHeight: 220,
  },
  scrollContent: {
    paddingBottom: 4,
  },
  overview: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 22,
  },
});
