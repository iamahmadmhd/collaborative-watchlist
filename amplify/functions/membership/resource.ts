import { defineFunction } from '@aws-amplify/backend';

// Handler behind the addMember / removeMember / leaveWatchlist / changeMemberRole
// mutations. Its table names are wired in backend.ts rather than declared here,
// because it writes through TransactWriteItems rather than the generated resolvers
// and the tables do not exist until backend.data is synthesized; handler.ts reads
// them via process.env rather than the typed $amplify/env import.
// resourceGroupName: see System Design §4.6.
export const membership = defineFunction({
    name: 'membership',
    resourceGroupName: 'data',
});
