import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../models/permission_model.dart';
import '../config/app_theme.dart';

/// Widget للتحقق من الصلاحيات
/// يعرض المحتوى فقط إذا كان المستخدم لديه الصلاحية المطلوبة
class PermissionGuard extends StatelessWidget {
  final Permission permission;
  final Widget child;
  final Widget? fallback;
  final bool showMessage;

  const PermissionGuard({
    super.key,
    required this.permission,
    required this.child,
    this.fallback,
    this.showMessage = false,
  });

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (auth.hasPermission(permission)) {
          return child;
        }

        if (fallback != null) {
          return fallback!;
        }

        if (showMessage) {
          return _buildNoPermissionMessage();
        }

        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildNoPermissionMessage() {
    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.lock_outline, size: 48, color: Colors.grey[400]),
          const SizedBox(height: 12),
          Text(
            'لا تملك صلاحية لهذا الإجراء',
            style: TextStyle(color: Colors.grey[600], fontSize: 14),
          ),
        ],
      ),
    );
  }
}

/// Widget للتحقق من إمكانية التعديل (Admin أو Owner)
class EditPermissionGuard extends StatelessWidget {
  final Widget child;
  final Widget? fallback;

  const EditPermissionGuard({super.key, required this.child, this.fallback});

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (auth.canEdit) {
          return child;
        }
        return fallback ?? const SizedBox.shrink();
      },
    );
  }
}

/// زر مع حماية الصلاحيات
class PermissionButton extends StatelessWidget {
  final Permission permission;
  final VoidCallback onPressed;
  final Widget child;
  final ButtonStyle? style;
  final bool showDisabled;

  const PermissionButton({
    super.key,
    required this.permission,
    required this.onPressed,
    required this.child,
    this.style,
    this.showDisabled = true,
  });

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final hasPermission = auth.hasPermission(permission);

        if (!hasPermission && !showDisabled) {
          return const SizedBox.shrink();
        }

        return ElevatedButton(
          onPressed: hasPermission ? onPressed : null,
          style: style,
          child: child,
        );
      },
    );
  }
}

/// أيقونة زر مع حماية الصلاحيات
class PermissionIconButton extends StatelessWidget {
  final Permission permission;
  final VoidCallback onPressed;
  final IconData icon;
  final Color? color;
  final String? tooltip;
  final bool showDisabled;

  const PermissionIconButton({
    super.key,
    required this.permission,
    required this.onPressed,
    required this.icon,
    this.color,
    this.tooltip,
    this.showDisabled = false,
  });

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        final hasPermission = auth.hasPermission(permission);

        if (!hasPermission && !showDisabled) {
          return const SizedBox.shrink();
        }

        return IconButton(
          onPressed: hasPermission ? onPressed : null,
          icon: Icon(icon),
          color: hasPermission ? color : Colors.grey,
          tooltip: tooltip,
        );
      },
    );
  }
}

/// زر عائم مع حماية الصلاحيات
class PermissionFloatingButton extends StatelessWidget {
  final Permission permission;
  final VoidCallback onPressed;
  final Widget child;
  final String? tooltip;

  const PermissionFloatingButton({
    super.key,
    required this.permission,
    required this.onPressed,
    required this.child,
    this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (!auth.hasPermission(permission)) {
          return const SizedBox.shrink();
        }

        return FloatingActionButton(
          onPressed: onPressed,
          tooltip: tooltip,
          child: child,
        );
      },
    );
  }
}

/// شريحة تعرض دور المستخدم
class RoleChip extends StatelessWidget {
  final UserRole role;
  final bool showIcon;

  const RoleChip({super.key, required this.role, this.showIcon = true});

  @override
  Widget build(BuildContext context) {
    Color backgroundColor;
    Color textColor;
    IconData icon;

    switch (role) {
      case UserRole.owner:
        backgroundColor = AppTheme.primaryColor;
        textColor = Colors.white;
        icon = Icons.verified;
        break;
      case UserRole.admin:
        backgroundColor = AppTheme.successColor;
        textColor = Colors.white;
        icon = Icons.admin_panel_settings;
        break;
      case UserRole.user:
        backgroundColor = Colors.grey[300]!;
        textColor = Colors.grey[800]!;
        icon = Icons.person;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showIcon) ...[
            Icon(icon, size: 16, color: textColor),
            const SizedBox(width: 6),
          ],
          Text(
            getRoleDisplayName(role),
            style: TextStyle(
              color: textColor,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

/// رسالة للمستخدمين العاديين
class ReadOnlyBanner extends StatelessWidget {
  const ReadOnlyBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (auth.canEdit) {
          return const SizedBox.shrink();
        }

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: AppTheme.warningColor.withValues(alpha: 0.1),
            border: Border(
              bottom: BorderSide(
                color: AppTheme.warningColor.withValues(alpha: 0.3),
              ),
            ),
          ),
          child: Row(
            children: [
              Icon(
                Icons.info_outline,
                size: 18,
                color: AppTheme.warningColor.withValues(alpha: 0.8),
              ),
              const SizedBox(width: 8),
              Text(
                'أنت في وضع القراءة فقط',
                style: TextStyle(
                  color: AppTheme.warningColor.withValues(alpha: 0.9),
                  fontSize: 13,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Dialog لعدم وجود صلاحية
void showNoPermissionDialog(BuildContext context) {
  showDialog(
    context: context,
    builder: (context) => Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppTheme.dangerColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(
                Icons.lock_outline,
                color: AppTheme.dangerColor,
              ),
            ),
            const SizedBox(width: 12),
            const Text('صلاحية مطلوبة'),
          ],
        ),
        content: const Text(
          'لا تملك الصلاحية لتنفيذ هذا الإجراء.\n\nتواصل مع المدير للحصول على الصلاحيات اللازمة.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('حسناً'),
          ),
        ],
      ),
    ),
  );
}
