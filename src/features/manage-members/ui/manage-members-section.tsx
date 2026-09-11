import { XMarkIcon } from '@heroicons/react/24/solid';
import { useCurrentUser } from '../../../entities/member/api/use-current-user';
import {
    useWatchlistMembers,
    type WatchlistMemberWithProfile,
} from '../../../entities/watchlist/api/use-watchlist-members';
import type { WatchlistRole } from '../../../entities/watchlist/model/watchlist';
import { RoleBadge } from '../../../entities/watchlist/ui/role-badge';
import { memberColor, memberInitial } from '../../../entities/member/model/member-color';
import { Select } from '../../../shared/ui/select';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { AddMemberDialog } from './add-member-dialog';
import { useChangeMemberRole, useLeaveWatchlist, useRemoveMember } from '../api/manage-members';

type AssignableRole = 'EDITOR' | 'VIEWER';

const ROLE_ITEMS: { value: AssignableRole; label: string }[] = [
    { value: 'EDITOR', label: 'Editor' },
    { value: 'VIEWER', label: 'Viewer' },
];

// FR-MEM-1..10, replacing watchlist-detail-page's former read-only MembersRow. The
// Owner sees an "Add collaborator" trigger and, per member, a role selector and a
// remove control (NFR-USE-3: both a role change and a removal are destructive
// enough to warrant a confirm — this component supplies that confirm for removal
// itself, while a role change is reversible enough not to need one). A non-owner
// collaborator sees everyone read-only, plus a "Leave" control on their own row
// (FR-MEM-5) — never on the Owner's row (FR-MEM-6, also enforced server-side).
//
// This is presentational gating only (CLAUDE.md's Authorization section):
// addMember/removeMember/changeMemberRole/leaveWatchlist all re-check the caller
// server-side (membership/handler.ts) regardless of what this component decides
// to render.
export function ManageMembersSection({
    watchlistId,
    role,
    onLeft,
    className,
}: {
    watchlistId: string;
    role: WatchlistRole | null | undefined;
    onLeft: () => void;
    className?: string;
}) {
    const membersQuery = useWatchlistMembers(watchlistId);
    const currentUserQuery = useCurrentUser();
    const isOwner = role === 'OWNER';

    if (membersQuery.isPending || membersQuery.isError || membersQuery.data.length === 0) {
        return isOwner ? (
            <div className={className}>
                <AddMemberDialog watchlistId={watchlistId} />
            </div>
        ) : null;
    }

    return (
        <div className={`flex flex-col gap-2.5 ${className ?? ''}`}>
            <div className='flex flex-wrap items-center gap-2'>
                {membersQuery.data.map((member) => (
                    <MemberRow
                        key={member.userId}
                        watchlistId={watchlistId}
                        member={member}
                        isOwner={isOwner}
                        isSelf={member.userId === currentUserQuery.data?.id}
                        onLeft={onLeft}
                    />
                ))}
            </div>
            {isOwner && <AddMemberDialog watchlistId={watchlistId} />}
        </div>
    );
}

function MemberRow({
    watchlistId,
    member,
    isOwner,
    isSelf,
    onLeft,
}: {
    watchlistId: string;
    member: WatchlistMemberWithProfile;
    isOwner: boolean;
    isSelf: boolean;
    onLeft: () => void;
}) {
    const label = member.displayName ?? (member.username ? `@${member.username}` : 'Member');
    const changeRole = useChangeMemberRole(watchlistId);

    return (
        <div className='border-border bg-raised flex items-center gap-1.5 rounded-full border py-1 pr-2 pl-1'>
            <div
                className='text-raised flex size-5 flex-none items-center justify-center rounded-full text-[10px] font-bold'
                style={{ background: memberColor(member.userId) }}
            >
                {memberInitial(label)}
            </div>
            <span className='text-text text-xs font-medium'>{label}</span>

            {isOwner && !isSelf && member.role !== 'OWNER' ? (
                <Select
                    items={ROLE_ITEMS}
                    value={member.role as AssignableRole}
                    onValueChange={(next) => changeRole.mutate({ userId: member.userId, role: next })}
                    aria-label={`Change ${label}’s role`}
                    className='h-6 gap-1 px-1.5 text-[10px]'
                />
            ) : (
                <RoleBadge role={member.role} />
            )}

            {isOwner && !isSelf && member.role !== 'OWNER' && (
                <RemoveMemberButton watchlistId={watchlistId} userId={member.userId} label={label} />
            )}
            {!isOwner && isSelf && member.role !== 'OWNER' && <LeaveButton watchlistId={watchlistId} onLeft={onLeft} />}
        </div>
    );
}

function RemoveMemberButton({ watchlistId, userId, label }: { watchlistId: string; userId: string; label: string }) {
    const removeMember = useRemoveMember(watchlistId);

    return (
        <ConfirmDialog
            trigger={
                <button
                    type='button'
                    aria-label={`Remove ${label} from this watchlist`}
                    className='text-muted hover:text-danger flex-none'
                >
                    <XMarkIcon className='size-3.5' />
                </button>
            }
            title='Remove collaborator?'
            description={`${label} will lose access to this watchlist immediately.`}
            confirmLabel='Remove'
            fallbackErrorMessage='Could not remove that collaborator.'
            onConfirm={async () => {
                await removeMember.mutateAsync(userId);
            }}
        />
    );
}

function LeaveButton({ watchlistId, onLeft }: { watchlistId: string; onLeft: () => void }) {
    const leaveWatchlist = useLeaveWatchlist(watchlistId);

    return (
        <ConfirmDialog
            trigger={
                <button
                    type='button'
                    className='text-muted hover:text-danger font-mono text-[10px] tracking-[0.04em] uppercase'
                >
                    Leave
                </button>
            }
            title='Leave this watchlist?'
            description="You'll lose access until an Owner adds you back."
            confirmLabel='Leave'
            fallbackErrorMessage='Could not leave this watchlist.'
            onConfirm={async () => {
                await leaveWatchlist.mutateAsync();
                onLeft();
            }}
        />
    );
}
