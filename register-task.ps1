$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c start /min "" "C:\Users\anahu\anahuac-rv-park\start-rv-park.bat"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User 'LAPTOP-1IUKSN3S\anahu'
$principal = New-ScheduledTaskPrincipal -UserId 'LAPTOP-1IUKSN3S\anahu' -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet
Register-ScheduledTask -TaskName 'RV Park Start' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
