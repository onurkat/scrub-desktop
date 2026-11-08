// Packaged Windows processes have an AUMID assigned by MSIX, which differs
// from the Tauri bundle identifier. Ask Windows rather than guessing a family.
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentApplicationUserModelId(length: *mut u32, id: *mut u16) -> i32;
}
pub fn packaged_id() -> Result<Option<String>, String> {
    let mut length = 0;
    // SAFETY: Windows accepts a null buffer for the sizing call.
    let status = unsafe { GetCurrentApplicationUserModelId(&mut length, std::ptr::null_mut()) };
    if status == 15703 {
        // APPMODEL_ERROR_NO_APPLICATION
        return Ok(None);
    }
    if status != 122 || length == 0 || length > 32768 {
        return Err("notificationError".into());
    }
    let mut buffer = vec![0u16; length as usize];
    // SAFETY: buffer has the length requested by the sizing call.
    if unsafe { GetCurrentApplicationUserModelId(&mut length, buffer.as_mut_ptr()) } != 0 {
        return Err("notificationError".into());
    }
    let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    String::from_utf16(&buffer[..end])
        .map(Some)
        .map_err(|_| "notificationError".into())
}
