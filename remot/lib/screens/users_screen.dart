import 'package:flutter/material.dart';
import '../services/supabase_service.dart';
import '../config/app_theme.dart';

/// شاشة إدارة المستخدمين - للأدمن فقط
class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  List<Map<String, dynamic>> _users = [];
  bool _isLoading = true;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  Future<void> _loadUsers() async {
    try {
      final response = await SupabaseService.client
          .from('users')
          .select()
          .order('created_at', ascending: false);

      if (mounted) {
        setState(() {
          _users = List<Map<String, dynamic>>.from(response);
          _isLoading = false;
        });
        print('👥 Loaded ${_users.length} users');
      }
    } catch (e) {
      print('❌ Error loading users: $e');
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  List<Map<String, dynamic>> get _filteredUsers {
    if (_searchQuery.isEmpty) return _users;
    return _users.where((u) {
      final name = (u['name'] ?? '').toString().toLowerCase();
      final email = (u['email'] ?? '').toString().toLowerCase();
      final username = (u['username'] ?? '').toString().toLowerCase();
      return name.contains(_searchQuery.toLowerCase()) ||
          email.contains(_searchQuery.toLowerCase()) ||
          username.contains(_searchQuery.toLowerCase());
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final gradientColors = isDark
        ? [const Color(0xFF0A0E21), const Color(0xFF1A1F38)]
        : [const Color(0xFFF5F7FA), const Color(0xFFE8EEF5)];

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: gradientColors,
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              _buildSearchBar(),
              _buildStatsBar(),
              Expanded(
                child: _isLoading
                    ? const Center(child: CircularProgressIndicator())
                    : _filteredUsers.isEmpty
                    ? _buildEmptyState()
                    : _buildUsersList(),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        heroTag: 'users_fab',
        onPressed: _showAddUserDialog,
        backgroundColor: AppTheme.primaryColor,
        child: const Icon(Icons.person_add, color: Colors.white),
      ),
    );
  }

  Widget _buildHeader() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final textSecondaryColor = isDark
        ? Colors.white70
        : const Color(0xFF6B7280);

    return Container(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: Icon(Icons.arrow_back_ios, color: textColor),
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.purple.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.people, color: Colors.purple, size: 28),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'المستخدمون',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: textColor,
                  ),
                ),
                Text(
                  'إدارة حسابات المستخدمين',
                  style: TextStyle(color: textSecondaryColor, fontSize: 14),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _loadUsers,
            icon: Icon(Icons.refresh, color: textSecondaryColor),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final hintColor = isDark
        ? Colors.white.withValues(alpha: 0.5)
        : const Color(0xFF9CA3AF);
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.white;
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: TextField(
        style: TextStyle(color: textColor),
        onChanged: (value) => setState(() => _searchQuery = value),
        decoration: InputDecoration(
          hintText: 'بحث عن مستخدم...',
          hintStyle: TextStyle(color: hintColor),
          border: InputBorder.none,
          icon: Icon(Icons.search, color: hintColor),
        ),
      ),
    );
  }

  Widget _buildStatsBar() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.white;
    final borderColor = isDark
        ? Colors.white.withValues(alpha: 0.1)
        : Colors.black.withValues(alpha: 0.1);

    final admins = _users
        .where((u) => u['is_admin'] == true || u['role'] == 'admin')
        .length;
    final activeUsers = _users.where((u) => u['is_active'] != false).length;

    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        children: [
          _buildStatItem('المجموع', _users.length.toString(), Colors.blue),
          _buildStatItem('المدراء', admins.toString(), Colors.purple),
          _buildStatItem('النشطين', activeUsers.toString(), Colors.green),
        ],
      ),
    );
  }

  Widget _buildStatItem(String label, String value, Color color) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final labelColor = isDark ? Colors.white70 : const Color(0xFF6B7280);

    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          Text(label, style: TextStyle(color: labelColor, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final iconColor = isDark
        ? Colors.white.withValues(alpha: 0.3)
        : Colors.grey.withValues(alpha: 0.3);
    final textColor = isDark
        ? Colors.white.withValues(alpha: 0.7)
        : const Color(0xFF6B7280);

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.people_outline, size: 80, color: iconColor),
          const SizedBox(height: 16),
          Text(
            'لا يوجد مستخدمون',
            style: TextStyle(color: textColor, fontSize: 18),
          ),
        ],
      ),
    );
  }

  Widget _buildUsersList() {
    return RefreshIndicator(
      onRefresh: _loadUsers,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        itemCount: _filteredUsers.length,
        itemBuilder: (context, index) {
          return _buildUserCard(_filteredUsers[index]);
        },
      ),
    );
  }

  Widget _buildUserCard(Map<String, dynamic> user) {
    final isAdmin = user['is_admin'] == true || user['role'] == 'admin';
    final isActive = user['is_active'] != false;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : const Color(0xFF1A2027);
    final textSecondaryColor = isDark
        ? Colors.white.withValues(alpha: 0.7)
        : const Color(0xFF6B7280);
    final bgColor = isDark
        ? Colors.white.withValues(alpha: 0.05)
        : Colors.white;
    final borderColor = isDark
        ? (isAdmin
              ? Colors.purple.withValues(alpha: 0.3)
              : Colors.white.withValues(alpha: 0.1))
        : (isAdmin
              ? Colors.purple.withValues(alpha: 0.3)
              : Colors.black.withValues(alpha: 0.1));
    final menuBgColor = isDark ? const Color(0xFF1E1E2E) : Colors.white;
    final menuTextColor = isDark ? Colors.white : const Color(0xFF1A2027);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
        boxShadow: isDark
            ? []
            : [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: CircleAvatar(
          radius: 28,
          backgroundColor: isAdmin
              ? Colors.purple.withValues(alpha: 0.2)
              : Colors.blue.withValues(alpha: 0.2),
          child: Text(
            (user['name'] ?? user['username'] ?? 'U')[0].toUpperCase(),
            style: TextStyle(
              color: isAdmin ? Colors.purple : Colors.blue,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(
                user['name'] ?? user['username'] ?? 'مستخدم',
                style: TextStyle(
                  color: textColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),
            ),
            if (isAdmin)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.purple.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'مدير',
                  style: TextStyle(color: Colors.purple, fontSize: 10),
                ),
              ),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(
              user['email'] ?? 'لا يوجد بريد',
              style: TextStyle(color: textSecondaryColor),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: isActive ? Colors.green : Colors.red,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  isActive ? 'نشط' : 'غير نشط',
                  style: TextStyle(
                    color: isActive ? Colors.green : Colors.red,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ],
        ),
        trailing: PopupMenuButton<String>(
          icon: Icon(Icons.more_vert, color: textSecondaryColor),
          color: menuBgColor,
          onSelected: (value) => _handleUserAction(value, user),
          itemBuilder: (context) => [
            PopupMenuItem(
              value: 'view',
              child: Row(
                children: [
                  const Icon(Icons.visibility, color: Colors.blue, size: 20),
                  const SizedBox(width: 8),
                  Text('عرض', style: TextStyle(color: menuTextColor)),
                ],
              ),
            ),
            PopupMenuItem(
              value: 'edit',
              child: Row(
                children: [
                  const Icon(Icons.edit, color: Colors.orange, size: 20),
                  const SizedBox(width: 8),
                  Text('تعديل', style: TextStyle(color: menuTextColor)),
                ],
              ),
            ),
            PopupMenuItem(
              value: 'toggle',
              child: Row(
                children: [
                  Icon(
                    isActive ? Icons.block : Icons.check_circle,
                    color: isActive ? Colors.orange : Colors.green,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    isActive ? 'تعطيل' : 'تفعيل',
                    style: TextStyle(color: menuTextColor),
                  ),
                ],
              ),
            ),
            PopupMenuItem(
              value: 'delete',
              child: Row(
                children: [
                  const Icon(Icons.delete, color: Colors.red, size: 20),
                  const SizedBox(width: 8),
                  Text('حذف', style: TextStyle(color: menuTextColor)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _handleUserAction(String action, Map<String, dynamic> user) {
    switch (action) {
      case 'view':
        _showUserDetails(user);
        break;
      case 'edit':
        _showEditUserDialog(user);
        break;
      case 'toggle':
        _toggleUserStatus(user);
        break;
      case 'delete':
        _confirmDeleteUser(user);
        break;
    }
  }

  void _showUserDetails(Map<String, dynamic> user) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Container(
        height: MediaQuery.of(context).size.height * 0.6,
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2E),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 20),
            CircleAvatar(
              radius: 40,
              backgroundColor: Colors.purple.withValues(alpha: 0.2),
              child: Text(
                (user['name'] ?? 'U')[0].toUpperCase(),
                style: const TextStyle(color: Colors.purple, fontSize: 32),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              user['name'] ?? user['username'] ?? 'مستخدم',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              user['email'] ?? '',
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 20),
            _buildDetailRow('اسم المستخدم', user['username'] ?? 'غير محدد'),
            _buildDetailRow('الدور', user['role'] ?? 'user'),
            _buildDetailRow(
              'الحالة',
              user['is_active'] != false ? 'نشط' : 'غير نشط',
            ),
            _buildDetailRow('تاريخ الإنشاء', _formatDate(user['created_at'])),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Text(label, style: const TextStyle(color: Colors.white70)),
          const Spacer(),
          Text(value, style: const TextStyle(color: Colors.white)),
        ],
      ),
    );
  }

  String _formatDate(dynamic date) {
    if (date == null) return 'غير متوفر';
    try {
      final dt = DateTime.parse(date.toString());
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (e) {
      return 'غير متوفر';
    }
  }

  void _showAddUserDialog() {
    final nameController = TextEditingController();
    final emailController = TextEditingController();
    final usernameController = TextEditingController();
    final passwordController = TextEditingController();
    bool isAdmin = false;

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E1E2E),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(Icons.person_add, color: Colors.green),
              SizedBox(width: 8),
              Text('إضافة مستخدم جديد', style: TextStyle(color: Colors.white)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildDialogTextField(nameController, 'الاسم', Icons.person),
                const SizedBox(height: 12),
                _buildDialogTextField(
                  usernameController,
                  'اسم المستخدم',
                  Icons.account_circle,
                ),
                const SizedBox(height: 12),
                _buildDialogTextField(
                  emailController,
                  'البريد الإلكتروني',
                  Icons.email,
                ),
                const SizedBox(height: 12),
                _buildDialogTextField(
                  passwordController,
                  'كلمة المرور',
                  Icons.lock,
                  isPassword: true,
                ),
                const SizedBox(height: 12),
                SwitchListTile(
                  title: const Text(
                    'مدير النظام',
                    style: TextStyle(color: Colors.white),
                  ),
                  value: isAdmin,
                  onChanged: (value) => setDialogState(() => isAdmin = value),
                  activeThumbColor: Colors.purple,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () async {
                if (usernameController.text.isEmpty ||
                    passwordController.text.isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('يرجى ملء الحقول المطلوبة')),
                  );
                  return;
                }

                try {
                  await SupabaseService.client.from('users').insert({
                    'name': nameController.text,
                    'username': usernameController.text,
                    'email': emailController.text,
                    'password_hash':
                        passwordController.text, // Should be hashed
                    'is_admin': isAdmin,
                    'role': isAdmin ? 'admin' : 'user',
                    'is_active': true,
                    'created_at': DateTime.now().toIso8601String(),
                  });

                  if (!context.mounted) return;
                  Navigator.pop(context);
                  _loadUsers();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('تم إضافة المستخدم بنجاح'),
                      backgroundColor: Colors.green,
                    ),
                  );
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('خطأ: $e'),
                      backgroundColor: Colors.red,
                    ),
                  );
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryColor,
                foregroundColor: Colors.white,
              ),
              child: const Text('إضافة'),
            ),
          ],
        ),
      ),
    );
  }

  void _showEditUserDialog(Map<String, dynamic> user) {
    final nameController = TextEditingController(text: user['name'] ?? '');
    final emailController = TextEditingController(text: user['email'] ?? '');
    bool isAdmin = user['is_admin'] == true || user['role'] == 'admin';

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1E1E2E),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(Icons.edit, color: Colors.orange),
              SizedBox(width: 8),
              Text('تعديل المستخدم', style: TextStyle(color: Colors.white)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildDialogTextField(nameController, 'الاسم', Icons.person),
                const SizedBox(height: 12),
                _buildDialogTextField(
                  emailController,
                  'البريد الإلكتروني',
                  Icons.email,
                ),
                const SizedBox(height: 12),
                SwitchListTile(
                  title: const Text(
                    'مدير النظام',
                    style: TextStyle(color: Colors.white),
                  ),
                  value: isAdmin,
                  onChanged: (value) => setDialogState(() => isAdmin = value),
                  activeThumbColor: Colors.purple,
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء'),
            ),
            ElevatedButton(
              onPressed: () async {
                try {
                  await SupabaseService.client
                      .from('users')
                      .update({
                        'name': nameController.text,
                        'email': emailController.text,
                        'is_admin': isAdmin,
                        'role': isAdmin ? 'admin' : 'user',
                      })
                      .eq('id', user['id']);

                  if (!context.mounted) return;
                  Navigator.pop(context);
                  _loadUsers();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('تم تحديث المستخدم بنجاح'),
                      backgroundColor: Colors.green,
                    ),
                  );
                } catch (e) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('خطأ: $e'),
                      backgroundColor: Colors.red,
                    ),
                  );
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.orange,
                foregroundColor: Colors.white,
              ),
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _toggleUserStatus(Map<String, dynamic> user) async {
    final isActive = user['is_active'] != false;
    try {
      await SupabaseService.client
          .from('users')
          .update({'is_active': !isActive})
          .eq('id', user['id']);

      _loadUsers();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(isActive ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم'),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('خطأ: $e'), backgroundColor: Colors.red),
      );
    }
  }

  void _confirmDeleteUser(Map<String, dynamic> user) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        title: const Row(
          children: [
            Icon(Icons.warning, color: Colors.red),
            SizedBox(width: 8),
            Text('تأكيد الحذف', style: TextStyle(color: Colors.white)),
          ],
        ),
        content: Text(
          'هل أنت متأكد من حذف "${user['name'] ?? user['username']}"؟',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          ElevatedButton(
            onPressed: () async {
              try {
                await SupabaseService.client
                    .from('users')
                    .delete()
                    .eq('id', user['id']);

                if (!context.mounted) return;
                Navigator.pop(context);
                _loadUsers();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('تم حذف المستخدم'),
                    backgroundColor: Colors.green,
                  ),
                );
              } catch (e) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('خطأ: $e'),
                    backgroundColor: Colors.red,
                  ),
                );
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
            ),
            child: const Text('حذف'),
          ),
        ],
      ),
    );
  }

  Widget _buildDialogTextField(
    TextEditingController controller,
    String label,
    IconData icon, {
    bool isPassword = false,
  }) {
    return TextField(
      controller: controller,
      obscureText: isPassword,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Colors.white70),
        prefixIcon: Icon(icon, color: Colors.white54),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppTheme.primaryColor),
        ),
        filled: true,
        fillColor: Colors.white.withValues(alpha: 0.05),
      ),
    );
  }
}
