import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  fetchGroupMembers,
  addGroupMember,
  removeGroupMember,
  fetchGroupRoles,
  setGroupRoles,
  type Group,
  type GroupListItem,
  type GroupMember,
} from '../api/groups';
import { listRoles, type Role } from '../api/roles';
import { listUsers, type User } from '../api/users';
import EmptyState from '../components/EmptyState';
import { message } from '../api/feedback';
import { apiErrorMessage } from '../api/errors';
import { useAuthStore } from '../stores/auth';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// register relativeTime once at module load (Tenants precedent)
dayjs.extend(relativeTime);

interface GroupFormValues {
  name?: string;
  description?: string;
}

/** Detail drawer state for one group: members + bound-role editor. */
interface DrawerState {
  group: Group;
  members: GroupMember[];
  roles: Role[];
  boundRoleIds: string[];
}

export default function Groups() {
  const { t } = useTranslation();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('groups:write');
  const canDelete = hasPermission('groups:delete');

  const actionRef = useRef<ActionType>(null);
  const [loadError, setLoadError] = useState(false);

  // Create / edit modal (name + description)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<GroupFormValues>();

  // Detail drawer (members + role bindings)
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [memberPicker, setMemberPicker] = useState<string | undefined>(undefined);
  const [memberCandidates, setMemberCandidates] = useState<User[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  const openCreate = () => {
    setEditingGroup(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (group: Group) => {
    setEditingGroup(group);
    form.resetFields();
    form.setFieldsValue({ name: group.name, description: group.description });
    setModalOpen(true);
  };

  const handleSaveGroup = async () => {
    let values: GroupFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // field validation errors render inline
    }
    setSaving(true);
    try {
      const name = (values.name ?? '').trim();
      const description = (values.description ?? '').trim();
      if (editingGroup) {
        await updateGroup(editingGroup.id, { name, description });
        message.success(t('groups.updated'));
      } else {
        await createGroup({ name, ...(description ? { description } : {}) });
        message.success(t('groups.created'));
      }
      setModalOpen(false);
      setEditingGroup(null);
      actionRef.current?.reload();
    } catch (err) {
      message.error(apiErrorMessage(err, editingGroup ? t('groups.updateError') : t('groups.createError')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: GroupListItem) => {
    try {
      await deleteGroup(record.id);
      message.success(t('groups.deleted'));
      actionRef.current?.reload();
    } catch (err) {
      // LAST_ADMIN_GUARD 409 message passes through verbatim (apiErrorMessage, K-R6)
      message.error(apiErrorMessage(err, t('groups.deleteError')));
    }
  };

  const refreshDrawer = useCallback(
    async (group: Group): Promise<DrawerState> => {
      const [members, boundRoleIds, rolesResult] = await Promise.all([
        fetchGroupMembers(group.id),
        fetchGroupRoles(group.id),
        listRoles({ page: 1, pageSize: 100 }),
      ]);
      return { group, members, roles: rolesResult.data, boundRoleIds };
    },
    [],
  );

  const openDetail = async (record: GroupListItem) => {
    try {
      const state = await refreshDrawer(record);
      setDrawer(state);
      setSelectedRoleIds(state.boundRoleIds);
      setMemberPicker(undefined);
      setMemberCandidates([]);
    } catch (err) {
      message.error(apiErrorMessage(err, t('groups.detailError')));
    }
  };

  const closeDetail = () => {
    setDrawer(null);
    actionRef.current?.reload();
  };

  const loadMemberCandidates = async (keyword: string) => {
    if (!drawer) return;
    setMemberLoading(true);
    try {
      const result = await listUsers({ page: 1, pageSize: 20, search: keyword || undefined });
      const existing = new Set(drawer.members.map((m) => m.userId));
      setMemberCandidates(result.data.filter((u) => !existing.has(u.id)));
    } catch (err) {
      message.error(apiErrorMessage(err, t('groups.memberLoadError')));
    } finally {
      setMemberLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!drawer || !memberPicker) return;
    setAddingMember(true);
    try {
      await addGroupMember(drawer.group.id, memberPicker);
      message.success(t('groups.memberAdded'));
      setDrawer(await refreshDrawer(drawer.group));
      setMemberPicker(undefined);
      setMemberCandidates([]);
    } catch (err) {
      message.error(apiErrorMessage(err, t('groups.memberAddError')));
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!drawer) return;
    try {
      await removeGroupMember(drawer.group.id, userId);
      message.success(t('groups.memberRemoved'));
      setDrawer(await refreshDrawer(drawer.group));
    } catch (err) {
      message.error(apiErrorMessage(err, t('groups.memberRemoveError')));
    }
  };

  const handleSaveRoles = async () => {
    if (!drawer) return;
    setSavingRoles(true);
    try {
      await setGroupRoles(drawer.group.id, selectedRoleIds);
      message.success(t('groups.rolesSaved'));
      setDrawer(await refreshDrawer(drawer.group));
    } catch (err) {
      message.error(apiErrorMessage(err, t('groups.rolesSaveError')));
    } finally {
      setSavingRoles(false);
    }
  };

  const columns: ProColumns<GroupListItem>[] = [
    { title: t('groups.name'), dataIndex: 'name' },
    { title: t('groups.description'), dataIndex: 'description', search: false, ellipsis: true },
    {
      title: t('groups.memberCount'),
      dataIndex: 'memberCount',
      search: false,
      render: (_, record) => String(record.memberCount),
    },
    {
      title: t('groups.roleCount'),
      dataIndex: 'roleCount',
      search: false,
      render: (_, record) => String(record.roleCount),
    },
    {
      title: t('groups.createdAt'),
      dataIndex: 'createdAt',
      search: false,
      render: (_, record) => dayjs(record.createdAt).fromNow(),
    },
  ];

  // Actions column is always present: manage (read drawer) needs only groups:read;
  // the write/delete codes gate the individual buttons inside (spec gating).
  columns.push({
      title: t('groups.actions'),
      valueType: 'option',
      width: 280,
      render: (_, record) => {
        const actions: React.ReactNode[] = [
          <Button
            key="detail"
            type="link"
            size="small"
            icon={<TeamOutlined />}
            onClick={() => void openDetail(record)}
            data-testid={`groups-detail-${record.id}`}
          >
            {t('groups.manage')}
          </Button>,
        ];
        if (canWrite) {
          actions.push(
            <Button
              key="edit"
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
              data-testid="groups-edit"
            >
              {t('common.edit')}
            </Button>,
          );
        }
        if (canDelete) {
          actions.push(
            <Popconfirm
              key="delete"
              title={t('groups.deleteConfirm')}
              onConfirm={() => void handleDelete(record)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />} data-testid="groups-delete">
                {t('common.delete')}
              </Button>
            </Popconfirm>,
          );
        }
        return actions;
      },
  });

  return (
    <div data-testid="groups-page">
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={t('groups.loadError')}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()} data-testid="groups-load-retry">
              {t('common.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
          data-testid="groups-load-error"
        />
      )}
      <ProTable<GroupListItem>
        headerTitle={t('groups.title')}
        actionRef={actionRef}
        rowKey="id"
        scroll={{ x: 'max-content' }}
        columns={columns}
        data-testid="groups-table"
        request={async (params) => {
          try {
            const all = await fetchGroups();
            setLoadError(false);
            const term = String((params as { name?: unknown }).name ?? '').trim().toLowerCase();
            // Backend returns a plain array — filter client-side by name.
            const filtered = term
              ? all.filter((g) => g.name.toLowerCase().includes(term))
              : all;
            return { data: filtered, total: filtered.length, success: true };
          } catch {
            setLoadError(true);
            return { data: [], total: 0, success: false };
          }
        }}
        pagination={{ defaultPageSize: 10 }}
        search={{ labelWidth: 'auto' }}
        locale={{ emptyText: <EmptyState variant={loadError ? 'error' : 'no-data'} /> }}
        rowClassName={() => 'groups-row'}
        toolBarRender={
          canWrite
            ? () => [
                <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate} data-testid="groups-create">
                  {t('groups.create')}
                </Button>,
              ]
            : false
        }
      />

      <Modal
        data-testid="groups-form-modal"
        title={editingGroup ? t('groups.editTitle') : t('groups.createTitle')}
        open={modalOpen}
        onOk={handleSaveGroup}
        onCancel={() => {
          setModalOpen(false);
          setEditingGroup(null);
        }}
        confirmLoading={saving}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t('groups.name')}
            rules={[{ required: true, message: t('groups.nameRequired') }]}
          >
            <Input data-testid="groups-name-input" />
          </Form.Item>
          <Form.Item name="description" label={t('groups.description')}>
            <Input data-testid="groups-description-input" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={t('groups.detailTitle', { name: drawer?.group.name ?? '' })}
        width={560}
        open={drawer !== null}
        onClose={closeDetail}
        destroyOnHidden
        data-testid="groups-detail-drawer"
      >
        {drawer && (
          <Tabs
            defaultActiveKey="members"
            items={[
              {
                key: 'members',
                label: t('groups.membersTab'),
                children: (
                  <div data-testid="groups-members">
                    <List
                      size="small"
                      dataSource={drawer.members}
                      locale={{ emptyText: t('groups.noMembers') }}
                      renderItem={(member) => (
                        <List.Item
                          data-testid={`groups-member-${member.userId}`}
                          actions={
                            canWrite
                              ? [
                                  <Popconfirm
                                    key="remove"
                                    title={t('groups.removeMemberConfirm')}
                                    onConfirm={() => void handleRemoveMember(member.userId)}
                                    okText={t('common.confirm')}
                                    cancelText={t('common.cancel')}
                                  >
                                    <Button type="link" size="small" danger data-testid="groups-remove-member">
                                      {t('groups.removeMember')}
                                    </Button>
                                  </Popconfirm>,
                                ]
                              : []
                          }
                        >
                          <List.Item.Meta title={member.name} description={member.email} />
                        </List.Item>
                      )}
                    />
                    {canWrite && (
                      <Space.Compact style={{ width: '100%', marginTop: 12 }}>
                        <Select
                          style={{ flex: 1 }}
                          showSearch
                          filterOption={false}
                          loading={memberLoading}
                          placeholder={t('groups.memberPickerPlaceholder')}
                          value={memberPicker}
                          onSearch={(kw) => void loadMemberCandidates(kw)}
                          onOpenChange={(open) => { if (open) void loadMemberCandidates(''); }}
                          onChange={(value: string) => setMemberPicker(value)}
                          options={memberCandidates.map((u) => ({
                            value: u.id,
                            label: `${u.name} <${u.email}>`,
                          }))}
                          data-testid="groups-member-select"
                        />
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          disabled={!memberPicker}
                          loading={addingMember}
                          onClick={() => void handleAddMember()}
                          data-testid="groups-add-member"
                        >
                          {t('groups.addMember')}
                        </Button>
                      </Space.Compact>
                    )}
                  </div>
                ),
              },
              {
                key: 'roles',
                label: t('groups.rolesTab'),
                children: (
                  <div data-testid="groups-roles">
                    {drawer.roles.length === 0 ? (
                      <EmptyState variant="no-data" />
                    ) : (
                      <Checkbox.Group
                        value={selectedRoleIds}
                        onChange={(values) => setSelectedRoleIds(values as string[])}
                        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                        options={drawer.roles.map((role) => ({
                          label: role.name,
                          value: role.id,
                          disabled: !canWrite,
                        }))}
                      />
                    )}
                    {canWrite && (
                      <Button
                        type="primary"
                        style={{ marginTop: 16 }}
                        loading={savingRoles}
                        onClick={() => void handleSaveRoles()}
                        data-testid="groups-save-roles"
                      >
                        {t('groups.saveRoles')}
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
