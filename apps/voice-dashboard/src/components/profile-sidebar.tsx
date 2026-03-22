"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Copy, MoreVertical, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  useActivateProfile,
  useCreateProfile,
  useDeleteProfile,
  useDuplicateProfile,
  useProfiles,
} from "@/lib/hooks/use-profiles";
import type { AgentProfile } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ProfileSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: profiles, isLoading, error } = useProfiles();
  const createProfile = useCreateProfile();
  const activateProfile = useActivateProfile();
  const duplicateProfile = useDuplicateProfile();
  const deleteProfile = useDeleteProfile();

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AgentProfile | null>(null);

  const selectedProfileId = useMemo(() => {
    const match = pathname.match(/\/profiles\/([^/]+)/);
    return match?.[1] ?? null;
  }, [pathname]);

  const handleCreate = () => {
    const name = newProfileName.trim();
    if (!name) {
      toast.error("Profile name is required");
      return;
    }

    createProfile.mutate(
      { name },
      {
        onSuccess: (created) => {
          toast.success("Profile created");
          setCreateOpen(false);
          setNewProfileName("");
          router.push(`/profiles/${created.id}`);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Failed to create profile");
        },
      },
    );
  };

  const handleActivate = (profile: AgentProfile) => {
    activateProfile.mutate(profile.id, {
      onSuccess: () => toast.success(`${profile.name} is now active`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to activate profile"),
    });
  };

  const handleDuplicate = (profile: AgentProfile) => {
    duplicateProfile.mutate(profile.id, {
      onSuccess: (duplicated) => {
        toast.success("Profile cloned");
        router.push(`/profiles/${duplicated.id}`);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to clone profile"),
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) {
      return;
    }
    deleteProfile.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Profile deleted");
        if (selectedProfileId === deleteTarget.id) {
          router.push("/profiles");
        }
        setDeleteTarget(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete profile"),
    });
  };

  return (
    <aside className="w-72 border-r bg-muted/40">
      <div className="flex h-screen flex-col p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Profiles</h2>
          <Dialog open={isCreateOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 size-4" />
                New Profile
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create profile</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  value={newProfileName}
                  onChange={(event) => setNewProfileName(event.target.value)}
                  placeholder="My Voice Agent"
                />
                <Button
                  className="w-full"
                  onClick={handleCreate}
                  disabled={createProfile.isPending}
                >
                  {createProfile.isPending ? "Creating..." : "Create"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-2 pr-3">
            {isLoading &&
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="rounded-lg border bg-card p-3">
                  <Skeleton className="mb-2 h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}

            {!isLoading && error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Failed to load profiles
              </div>
            )}

            {!isLoading && !error && profiles?.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No profiles yet. Create one to start editing.
              </div>
            )}

            {!isLoading &&
              !error &&
              profiles?.map((profile) => {
                const isSelected = selectedProfileId === profile.id;
                return (
                  <div
                    key={profile.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      isSelected ? "bg-accent" : "hover:bg-accent/70"
                    }`}
                  >
                    <div
                      className="cursor-pointer"
                      onClick={() => router.push(`/profiles/${profile.id}`)}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium">{profile.name}</p>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!profile.is_active && (
                              <DropdownMenuItem
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleActivate(profile);
                                }}
                              >
                                <Zap className="mr-2 size-4" />
                                Activate
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDuplicate(profile);
                              }}
                            >
                              <Copy className="mr-2 size-4" />
                              Clone
                            </DropdownMenuItem>
                            {!profile.is_active && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteTarget(profile);
                                }}
                              >
                                <Trash2 className="mr-2 size-4" />
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {profile.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                    </div>
                  </div>
                );
              })}
          </div>
        </ScrollArea>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Profile "{deleteTarget?.name}" will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProfile.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteProfile.isPending}
              onClick={handleDelete}
            >
              {deleteProfile.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
